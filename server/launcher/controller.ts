import {DesktopRecovery} from './desktop-recovery.js';
import {dirname} from 'node:path';
import {PluginRepositories,type RepositoryInput} from './plugin-repositories.js';
import {PluginCatalog,githubRepository,compareVersions,type CatalogPlugin,type PluginUpdate} from './plugin-catalog.js';
import {PluginInstaller} from './plugin-installer.js';
import {EventEmitter} from 'node:events';
import {PluginManager,type PluginManagerOptions} from './plugin-runtime.js';
import {DesktopService,type DesktopServiceDeps} from './desktop-service.js';
import {loadHostConfig,saveHostConfig,validateHostConfig,type HostConfig} from './host-config.js';
import type {DesktopSettings,LauncherHostStatus} from './plugin-contract.js';
export interface LauncherDependencies {
 recoveryIntervalMs?:number;
 desktop?:DesktopServiceDeps;
 pluginRuntime?:PluginManagerOptions;
 pluginUpdates?:{catalog?:PluginCatalog;repositories?:PluginRepositories;download?:(url:string)=>Promise<Buffer>};
 system?:{openExternal(url:string):unknown;writeClipboard(text:string):unknown};
}
/** 通用应用壳：桌面共享能力、插件生命周期及受控系统操作。 */
export class LauncherController extends EventEmitter {
 private config!:HostConfig;
 private desktop!:DesktopService;
 private plugins:PluginManager;
 private catalog:PluginCatalog;
 private repositories:PluginRepositories;
 private installer:PluginInstaller;
 private updateWasRunning=new Map<string,boolean>();
 private recovery=new DesktopRecovery();private recoveryTimer?:ReturnType<typeof setInterval>;private recoveryQueued=false;private recoveryPauses=0;private recoveryEpoch=0;private stopping=false;private recoveryTargets=new Set<string>();
 private logs:string[]=[];
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private configFile:string,packageRoot:string,private deps:LauncherDependencies={}){
  super();
  this.catalog=deps.pluginUpdates?.catalog??new PluginCatalog();
  this.repositories=deps.pluginUpdates?.repositories??new PluginRepositories(dirname(configFile));
  this.installer=new PluginInstaller(dirname(configFile),{
   snapshot:()=>this.plugins.strategySnapshot(),restorePolicy:policy=>this.plugins.restoreStrategy(policy as ReturnType<PluginManager['strategySnapshot']>),
   stop:async id=>{const p=this.plugins.list().plugins.find(p=>p.id===id);if(p&&!this.updateWasRunning.has(id))this.updateWasRunning.set(id,['running','waiting'].includes(p.state));if(p)await this.plugins.stop(id);},
   reload:id=>this.plugins.reloadPlugin(id),
   restore:async id=>{const p=this.plugins.list().plugins.find(p=>p.id===id);if(p?.enabled&&(this.updateWasRunning.get(id)||p.autoStart&&!this.updateWasRunning.has(id))){try{await this.plugins.start(id)}catch(e){if((e as {code?:string}).code!=='DESKTOP_NOT_READY')throw e;}}this.changed();}
  },deps.pluginUpdates?.download);

  this.plugins=new PluginManager(configFile,packageRoot,{call:(id,method,params)=>this.callHost(id,method,params),release:id=>this.desktop?.release(id)??Promise.resolve()}, {...deps.pluginRuntime,onChange:()=>this.changed(),onLog:(_id:string,message:string)=>this.log(message)});
 }
 async initialize(){
  this.config=await loadHostConfig(this.configFile);
  this.desktop=new DesktopService(this.config.desktop,{...this.deps.desktop,onEvent:(id,event)=>{this.plugins.sendEvent(id,event);this.changed();},onChange:()=>this.changed()});
  await this.repositories.list().catch(e=>this.log('插件仓库配置错误：'+String(e)));
  await this.plugins.initialize();this.startRecoveryMonitor();this.changed();return this.status();
 }
 private serialize<T>(fn:()=>Promise<T>){const result=this.queue.then(fn,fn);this.queue=result.catch(()=>{});return result;}
 private changed(){if(this.desktop)this.emit('status',this.status());}
 private log(message:string){this.logs.push(new Date().toLocaleTimeString('zh-CN')+' '+message.slice(0,500));if(this.logs.length>80)this.logs.shift();this.changed();}
 status():LauncherHostStatus{return {desktop:{...this.desktop.status(),recovery:this.recovery.status()},logs:[...this.logs]};}
 private startRecoveryMonitor(){
  this.stopping=false;if(this.recoveryTimer)return;
  this.recoveryTimer=setInterval(()=>{if(this.recoveryQueued||this.stopping)return;this.recoveryQueued=true;void this.serialize(()=>this.recoverDesktop()).catch(e=>this.log('桌面自动恢复失败：'+String(e))).finally(()=>{this.recoveryQueued=false;});},this.deps.recoveryIntervalMs??5000);this.recoveryTimer.unref();
 }
 /** RPC入口在等待旧操作前暂停恢复，返回幂等恢复函数。 */
 pauseAutomaticRecovery(){this.recoveryPauses++;this.recoveryEpoch++;let released=false;return()=>{if(!released){released=true;this.recoveryPauses--;}};}
 private cancelRecovery(id?:string){this.recoveryEpoch++;if(id)this.recoveryTargets.delete(id);else this.recoveryTargets.clear();}
 private async recoverDesktop(){
  if(this.stopping||this.recoveryPauses>0)return;const epoch=this.recoveryEpoch;
  const available=this.plugins.list().plugins,owners=new Set(this.desktop.owners());
  for(const id of this.recoveryTargets)if(!available.some(p=>p.id===id&&p.enabled))this.recoveryTargets.delete(id);
  const ids=available.filter(p=>p.enabled&&(this.recoveryTargets.has(p.id)||p.state==='waiting'||owners.has(p.id)&&p.state==='running')).map(p=>p.id);
  const wanted=ids.length>0;
  if(!wanted||this.config.desktop.autoReconnect===false){this.recovery.decide({wanted,healthy:false,restartable:false,activity:'unknown'},Date.now(),this.config.desktop);this.changed();return;}
  const health=await this.desktop.health();if(this.stopping||this.recoveryPauses>0||epoch!==this.recoveryEpoch)return;
  const waitingOwners=new Set(this.desktop.waitingOwners());const waiting=available.some(p=>ids.includes(p.id)&&(p.state==='waiting'||waitingOwners.has(p.id)))||this.recoveryTargets.size>0;
  const action=this.recovery.decide({...health,wanted,pendingPlugins:waiting},Date.now(),this.config.desktop);this.changed();if(!action)return;
  // 通道健康时仅重试等待插件；整个通道断开才回收所有桌面消费者。
  const targets=health.healthy?ids.filter(id=>this.recoveryTargets.has(id)||waitingOwners.has(id)||available.find(p=>p.id===id)?.state==='waiting'):ids;
  for(const id of targets)this.recoveryTargets.add(id);
  this.log(action==='restart'?'持续故障，自动重启桌面':'正在自动重连桌面');
  for(const id of targets){if(this.stopping||this.recoveryPauses>0||epoch!==this.recoveryEpoch)return;await this.plugins.stop(id);}
  if(this.stopping||this.recoveryPauses>0||epoch!==this.recoveryEpoch)return;
  try{if(action==='restart')await this.desktop.restart(()=>!this.stopping&&this.recoveryPauses===0&&epoch===this.recoveryEpoch);else await this.desktop.ensure(()=>!this.stopping&&this.recoveryPauses===0&&epoch===this.recoveryEpoch);}
  catch(e){this.log('桌面尚未就绪，将继续重试：'+String(e));return;}
  for(const id of targets){
   if(this.stopping||this.recoveryPauses>0||epoch!==this.recoveryEpoch)return;
   try{await this.desktop.withRecoveryGuard(id,()=>!this.stopping&&this.recoveryPauses===0&&epoch===this.recoveryEpoch,()=>this.plugins.start(id));this.recoveryTargets.delete(id);}
   catch(e){const code=(e as {code?:string}).code;if(code!=='DESKTOP_NOT_READY'&&code!=='RECOVERY_CANCELLED')this.recoveryTargets.delete(id);if(this.stopping||this.recoveryPauses>0||epoch!==this.recoveryEpoch)return;this.log(id+' 恢复未完成：'+String(e));}
  }
  this.changed();
 }
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
 uninstallPlugin(id:string){this.cancelRecovery(id);return this.serialize(async()=>{if(typeof id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id))throw Error('插件ID无效');await this.installer.sourceRepository(id);const result=await this.plugins.uninstall(id,()=>this.installer.forgetInstallation(id));this.log('插件 '+id+' 已删除，代码已备份，配置保留');this.changed();return result;});}
 listPluginRepositories(){return this.serialize(()=>this.repositories.list());}
 addPluginRepository(value:RepositoryInput){return this.serialize(()=>this.repositories.add(value));}
 editPluginRepository(id:string,value:RepositoryInput){return this.serialize(()=>this.repositories.update(id,value));}
 setPluginRepositoryEnabled(id:string,value:boolean){return this.serialize(()=>this.repositories.setEnabled(id,value));}
 removePluginRepository(id:string){return this.serialize(()=>this.repositories.remove(id));}
 private async availablePlugins(){if(this.deps.pluginUpdates?.catalog)return (await this.catalog.read()).plugins;const result=await this.repositories.catalogs();return result.catalogs.flatMap(c=>c.catalog.plugins);}
 checkPluginUpdates(){return this.serialize(async()=>{
  const plugins=await this.availablePlugins(),installed=this.plugins.list().plugins;
  return Promise.all(plugins.map(async p=>{const local=installed.find(x=>x.id===p.id),owner=await this.installer.sourceRepository(p.id),source=p.sourceRepository??githubRepository(p.git.url);const conflict=plugins.filter(x=>x.id===p.id).length>1;
   const directory=await this.installer.directoryIssue(p.id);return {...p,sourceRepository:source,installedVersion:local?.version,updateAvailable:!local||compareVersions(p.version,local.version)>0,compatible:p.compatibility.launcherApiVersion==='1',locallyModified:!!local&&await this.installer.isModified(p.id),sourceConflict:conflict,blockedReason:directory??(owner&&owner!==source?'已安装插件来自其他仓库，不允许替换来源':undefined)} as PluginUpdate;
  }));
 });}
 updatePlugin(id:string,options:{allowLocalChanges?:boolean;repository?:string}={}){return this.serialize(async()=>{
  if(typeof id!=='string'||typeof options!=='object'||options===null||(options.allowLocalChanges!==undefined&&typeof options.allowLocalChanges!=='boolean'))throw Error('更新参数无效');
  const all=(await this.availablePlugins()).filter(p=>p.id===id);let repository=options.repository!==undefined?githubRepository(options.repository):await this.installer.sourceRepository(id);if(!repository&&all.length>1)throw Error('多个仓库提供同名插件，请明确选择来源');
  const p=all.find(p=>!repository||(p.sourceRepository??githubRepository(p.git.url))===repository);if(!p)throw Error('原插件仓库已禁用、移除或未提供此插件');
  try{const result=await this.installer.install(p,options);this.log(`${p.name} 已更新至 ${p.version}`);return result;}finally{this.updateWasRunning.delete(id);this.changed();}
 });}
 pluginDirectory(){return this.plugins.directory;}
 listPlugins(){return this.plugins.list();}
 setPluginEnabled(id:string,enabled:boolean){if(!enabled)this.cancelRecovery(id);return this.serialize(async()=>{const result=await this.plugins.setEnabled(id,enabled);this.changed();return result;});}
 setPluginAutoStart(id:string,enabled:boolean){return this.serialize(async()=>{const result=await this.plugins.setAutoStart(id,enabled);this.changed();return result;});}
 startPlugin(id:string){return this.serialize(async()=>{try{return await this.plugins.start(id);}finally{this.changed();}});}
 stopPlugin(id:string){this.cancelRecovery(id);return this.serialize(async()=>{try{return await this.plugins.stop(id);}finally{this.changed();}});}
 reloadPlugins(){this.cancelRecovery();return this.serialize(async()=>{await this.plugins.reload();const result=await this.plugins.startAuto();this.changed();return result;});}
 invokePlugin(id:string,action:string,params:unknown){return this.serialize(()=>this.plugins.invoke(id,action,params));}
 resolvePluginUiAsset(id:string,asset:string){return this.plugins.resolveUiAsset(id,asset);}
 pluginUiUrl(id:string){const plugin=this.plugins.list().plugins.find(p=>p.id===id);if(!plugin?.enabled||!plugin.hasUi)throw Error('插件 UI 不可用');const entry=plugin.uiEntry;if(!entry)throw Error('插件 UI 未声明入口');return 'launcher-plugin://plugin/'+encodeURIComponent(id)+'/'+entry.split('/').map(encodeURIComponent).join('/');}
 saveDesktopSettings(settings:DesktopSettings){this.recoveryEpoch++;return this.serialize(async()=>{const next=validateHostConfig({schemaVersion:2,desktop:settings});const old=this.config;await this.desktop.updateSettings(next.desktop);try{await saveHostConfig(this.configFile,next);}catch(error){await this.desktop.updateSettings(old.desktop);throw error;}this.config=next;this.log('桌面设置已保存');return this.status();});}
 async openDesktop(){await this.desktop.open();this.changed();return this.status();}
 connectDesktop(){return this.serialize(async()=>{await this.desktop.ensure();await this.plugins.retryWaiting();this.changed();return this.status();});}
 restartDesktop(){const recovering=new Set(this.recoveryTargets);this.cancelRecovery();this.recovery.reset();return this.serialize(async()=>{
  const running=this.plugins.list().plugins.filter(p=>p.enabled&&(recovering.has(p.id)||['running','waiting'].includes(p.state))).map(p=>p.id);
  for(const id of running)await this.plugins.stop(id);
  await this.desktop.restart();
  const errors:string[]=[];for(const id of running){try{await this.plugins.start(id);}catch(e){errors.push(id+': '+(e instanceof Error?e.message:String(e)));}}
  this.log(errors.length?'桌面已重启，部分插件恢复失败：'+errors.join('；'):'桌面已重启，插件已恢复');return this.status();
 });}
 start(){this.startRecoveryMonitor();return this.serialize(async()=>{await this.plugins.startAuto();this.changed();return this.status();});}
 /** 仅供宿主退出超时使用，不属于 UI RPC。 */
 forceStop(){this.stopping=true;clearInterval(this.recoveryTimer);this.recoveryTimer=undefined;this.cancelRecovery();this.recovery.reset();this.plugins.forceShutdown();void this.desktop?.shutdown().catch(()=>{});}
 stop(){this.stopping=true;clearInterval(this.recoveryTimer);this.recoveryTimer=undefined;this.cancelRecovery();this.recovery.reset();return this.serialize(async()=>{try{await this.plugins.shutdown();}finally{await this.desktop?.shutdown();this.changed();}return this.desktop?this.status():undefined;});}
}
