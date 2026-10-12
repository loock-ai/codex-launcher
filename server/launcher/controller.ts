import {dirname} from 'node:path';
import {PluginCatalog} from './plugin-catalog.js';
import {PluginInstaller} from './plugin-installer.js';
import {EventEmitter} from 'node:events';
import {PluginManager,type PluginManagerOptions} from './plugin-runtime.js';
import {DesktopService,type DesktopServiceDeps} from './desktop-service.js';
import {loadHostConfig,saveHostConfig,validateHostConfig,type HostConfig} from './host-config.js';
import type {DesktopSettings,LauncherHostStatus} from './plugin-contract.js';
export interface LauncherDependencies {
 desktop?:DesktopServiceDeps;
 pluginRuntime?:PluginManagerOptions;
 pluginUpdates?:{catalog?:PluginCatalog;download?:(url:string)=>Promise<Buffer>};
 system?:{openExternal(url:string):unknown;writeClipboard(text:string):unknown};
}
/** 通用应用壳：桌面共享能力、插件生命周期及受控系统操作。 */
export class LauncherController extends EventEmitter {
 private config!:HostConfig;
 private desktop!:DesktopService;
 private plugins:PluginManager;
 private catalog:PluginCatalog;
 private installer:PluginInstaller;
 private updateWasRunning=new Map<string,boolean>();
 private logs:string[]=[];
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private configFile:string,packageRoot:string,private deps:LauncherDependencies={}){
  super();
  this.catalog=deps.pluginUpdates?.catalog??new PluginCatalog();
  this.installer=new PluginInstaller(dirname(configFile),{
   stop:async id=>{const p=this.plugins.list().plugins.find(p=>p.id===id);if(p&&!this.updateWasRunning.has(id))this.updateWasRunning.set(id,['running','waiting'].includes(p.state));if(p)await this.plugins.stop(id);},
   reload:id=>this.plugins.reloadPlugin(id),
   restore:async id=>{const p=this.plugins.list().plugins.find(p=>p.id===id);if(p?.enabled&&(this.updateWasRunning.get(id)||p.autoStart&&!this.updateWasRunning.has(id))){try{await this.plugins.start(id)}catch(e){if((e as {code?:string}).code!=='DESKTOP_NOT_READY')throw e;}}this.changed();}
  },deps.pluginUpdates?.download);

  this.plugins=new PluginManager(configFile,packageRoot,{call:(id,method,params)=>this.callHost(id,method,params),release:id=>this.desktop?.release(id)??Promise.resolve()}, {...deps.pluginRuntime,onChange:()=>this.changed(),onLog:(_id:string,message:string)=>this.log(message)});
 }
 async initialize(){
  this.config=await loadHostConfig(this.configFile);
  this.desktop=new DesktopService(this.config.desktop,{...this.deps.desktop,onEvent:(id,event)=>{this.plugins.sendEvent(id,event);this.changed();},onChange:()=>this.changed()});
  await this.plugins.initialize();this.changed();return this.status();
 }
 private serialize<T>(fn:()=>Promise<T>){const result=this.queue.then(fn,fn);this.queue=result.catch(()=>{});return result;}
 private changed(){if(this.desktop)this.emit('status',this.status());}
 private log(message:string){this.logs.push(new Date().toLocaleTimeString('zh-CN')+' '+message.slice(0,500));if(this.logs.length>80)this.logs.shift();this.changed();}
 status():LauncherHostStatus{return {desktop:this.desktop.status(),logs:[...this.logs]};}
 private async callHost(pluginId:string,method:string,params:unknown){
  const p=params as Record<string,unknown>|undefined;
  if(method==='system.openExternal'){
   if(typeof p?.url!=='string')throw Error('链接无效');const url=new URL(p.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('只允许 HTTP 或 HTTPS 链接');
   if(!this.deps.system)throw Error('系统打开链接能力不可用');return await this.deps.system.openExternal(url.href);
  }
  if(method==='clipboard.writeText'){
   if(typeof p?.text!=='string'||p.text.length>1_000_000)throw Error('剪贴板内容无效');if(!this.deps.system)throw Error('系统剪贴板能力不可用');return await this.deps.system.writeClipboard(p.text);
  }
  return this.desktop.call(pluginId,method,params);
 }
 checkPluginUpdates(){return this.serialize(async()=>{const updates=await this.catalog.check(this.plugins.list().plugins,id=>this.installer.isModified(id));return Promise.all(updates.map(async p=>({...p,blockedReason:await this.installer.directoryIssue(p.id)})));});}
 updatePlugin(id:string,options:{allowLocalChanges?:boolean}={}){return this.serialize(async()=>{if(typeof id!=='string'||typeof options!=='object'||options===null||(options.allowLocalChanges!==undefined&&typeof options.allowLocalChanges!=='boolean'))throw Error('更新参数无效');const p=(await this.catalog.read()).plugins.find(p=>p.id===id);if(!p)throw Error('插件目录中未找到插件');try{const result=await this.installer.install(p,options);this.log(`${p.name} 已更新至 ${p.version}`);return result;}finally{this.updateWasRunning.delete(id);this.changed();}});}
 pluginDirectory(){return this.plugins.directory;}
 listPlugins(){return this.plugins.list();}
 setPluginEnabled(id:string,enabled:boolean){return this.serialize(async()=>{const result=await this.plugins.setEnabled(id,enabled);this.changed();return result;});}
 setPluginAutoStart(id:string,enabled:boolean){return this.serialize(async()=>{const result=await this.plugins.setAutoStart(id,enabled);this.changed();return result;});}
 startPlugin(id:string){return this.serialize(async()=>{try{return await this.plugins.start(id);}finally{this.changed();}});}
 stopPlugin(id:string){return this.serialize(async()=>{try{return await this.plugins.stop(id);}finally{this.changed();}});}
 reloadPlugins(){return this.serialize(async()=>{await this.plugins.reload();const result=await this.plugins.startAuto();this.changed();return result;});}
 invokePlugin(id:string,action:string,params:unknown){return this.serialize(()=>this.plugins.invoke(id,action,params));}
 resolvePluginUiAsset(id:string,asset:string){return this.plugins.resolveUiAsset(id,asset);}
 pluginUiUrl(id:string){const plugin=this.plugins.list().plugins.find(p=>p.id===id);if(!plugin?.enabled||!plugin.hasUi)throw Error('插件 UI 不可用');const entry=plugin.uiEntry;if(!entry)throw Error('插件 UI 未声明入口');return 'launcher-plugin://plugin/'+encodeURIComponent(id)+'/'+entry.split('/').map(encodeURIComponent).join('/');}
 saveDesktopSettings(settings:DesktopSettings){return this.serialize(async()=>{const next=validateHostConfig({schemaVersion:2,desktop:settings});const old=this.config;await this.desktop.updateSettings(next.desktop);try{await saveHostConfig(this.configFile,next);}catch(error){await this.desktop.updateSettings(old.desktop);throw error;}this.config=next;this.log('桌面设置已保存');return this.status();});}
 async openDesktop(){await this.desktop.open();this.changed();return this.status();}
 connectDesktop(){return this.serialize(async()=>{await this.desktop.ensure();await this.plugins.retryWaiting();this.changed();return this.status();});}
 restartDesktop(){return this.serialize(async()=>{
  const running=this.plugins.list().plugins.filter(p=>p.enabled&&['running','waiting'].includes(p.state)).map(p=>p.id);
  for(const id of running)await this.plugins.stop(id);
  await this.desktop.restart();
  const errors:string[]=[];for(const id of running){try{await this.plugins.start(id);}catch(e){errors.push(id+': '+(e instanceof Error?e.message:String(e)));}}
  this.log(errors.length?'桌面已重启，部分插件恢复失败：'+errors.join('；'):'桌面已重启，插件已恢复');return this.status();
 });}
 start(){return this.serialize(async()=>{await this.plugins.startAuto();this.changed();return this.status();});}
 /** 仅供宿主退出超时使用，不属于 UI RPC。 */
 forceStop(){this.plugins.forceShutdown();void this.desktop?.shutdown().catch(()=>{});}
 stop(){return this.serialize(async()=>{try{await this.plugins.shutdown();}finally{await this.desktop?.shutdown();this.changed();}return this.desktop?this.status():undefined;});}
}
