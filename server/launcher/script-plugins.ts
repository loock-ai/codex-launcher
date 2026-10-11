import {mkdir,readdir,readFile,writeFile,stat,lstat,realpath,rename,mkdtemp,rm} from 'node:fs/promises';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {chromium,type Browser,type Page} from 'playwright-core';
import {validateCdpUrl} from '../cdp/dom.js';
export interface ScriptPlugin {id:string;name:string;description:string;version:string;enabled:boolean;state:'inactive'|'waiting'|'active'|'error';error?:string;path:string}
export interface ScriptPluginList {directory:string;plugins:ScriptPlugin[]}
export type PluginSnapshot=ScriptPluginList;
export interface PluginTransport {apply(id:string,source:string,generation:number):Promise<void|{cleanupError?:string}>;dispose(id:string,generation:number):Promise<void>;close():Promise<void>}
export type PluginTransportFactory=(endpoint:string,onRefresh:()=>void)=>PluginTransport;
const limit=1024*1024;
const message=(e:unknown)=>e instanceof Error?e.message:String(e);
async function deadline<T>(work:Promise<T>,label:string,ms=2500):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}finally{clearTimeout(timer);}}
// Electron 的 ASAR 路径由 readFile/readdir 虚拟化；避免 cp/copyFile 走原生路径。
async function copyTemplateFiles(source:string,destination:string){
 for(const entry of await readdir(source,{withFileTypes:true})){
  const from=join(source,entry.name),to=join(destination,entry.name);
  if(entry.isSymbolicLink())throw Error('模板不支持符号链接: '+entry.name);
  if(entry.isDirectory()){await mkdir(to);await copyTemplateFiles(from,to);}
  else if(entry.isFile()){if((await stat(from)).size>limit)throw Error('模板文件过大: '+entry.name);await writeFile(to,await readFile(from),{flag:'wx'});}
  else throw Error('模板包含非普通文件: '+entry.name);
 }
}
// 每个插件独立的资源槽和代际标记，迟到的异步执行无法重新激活旧实例。
export function pluginRuntimeScript(id:string,source:string|null,generation:number){return `(async()=>{
const key='__codexLauncherScriptPlugins_v1';
const slots=Object.prototype.hasOwnProperty.call(window,key)?window[key]:(window[key]=Object.create(null));
const id=${JSON.stringify(id)},generation=${generation},source=${JSON.stringify(source)};
const previous=slots[id];if(previous&&previous.generation>generation)return;
let cleanupError;
if(previous)try{await previous.dispose();}catch(e){cleanupError=String(e);}
if(slots[id]&&slots[id].generation>generation)return;
const controller=new AbortController(),cleanups=[];
let disposed=false;
let disposing;
const slot={generation,dispose:()=>{if(disposing)return disposing;disposed=true;controller.abort();disposing=(async()=>{let timer;try{const results=await Promise.race([Promise.allSettled(cleanups.splice(0).reverse().map(fn=>Promise.resolve().then(fn))),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('插件清理超时')),1500);})]);const failed=results.find(r=>r.status==='rejected');if(failed)throw Error('插件清理失败: '+failed.reason);}finally{clearTimeout(timer);}})();return disposing;}};
slots[id]=slot;if(source===null){await slot.dispose();if(cleanupError)throw Error(cleanupError);return;}
const context={signal:controller.signal,onDispose(fn){if(typeof fn!=='function')throw Error('onDispose 需要函数');if(disposed){Promise.resolve().then(fn).catch(console.error);}else cleanups.push(fn);}};
let timeout;
try{const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
await Promise.race([new AsyncFunction('context',source)(context),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('插件初始化超时')),10000);})]);
if(!cleanups.length&&!disposed)throw Error('插件必须先注册 onDispose 清理函数');
if(disposed||slots[id]!==slot){await slot.dispose();return;}
}catch(e){await slot.dispose();throw e;}finally{clearTimeout(timeout);}
return cleanupError?{cleanupError}:undefined;
})()`;}
export class CdpPluginTransport implements PluginTransport {
 private browser:Browser|null=null;private page:Page|null=null;private connecting:Promise<Page>|null=null;private closed=false;private retry:ReturnType<typeof setTimeout>|null=null;
 constructor(private endpoint:string,private refresh:()=>void){validateCdpUrl(endpoint);}
 private schedule(){if(this.closed||this.retry)return;this.retry=setTimeout(()=>{this.retry=null;this.refresh();},1500);this.retry.unref?.();}
 private async attach():Promise<Page>{
  if(this.closed)throw Error('插件连接已关闭');
  if(this.page&&!this.page.isClosed()&&this.browser?.isConnected()&&/^app:\/\/-\/index\.html(?:\?|$)/.test(this.page.url())&&!this.page.url().includes('initialRoute='))return this.page;
  if(this.connecting)return this.connecting;
  this.connecting=(async()=>{await this.browser?.close().catch(()=>{});this.page=null;const browser=await chromium.connectOverCDP(validateCdpUrl(this.endpoint),{timeout:5000});if(this.closed){await browser.close();throw Error('插件连接已关闭');}this.browser=browser;
  browser.on('disconnected',()=>this.schedule());for(const context of browser.contexts())context.on('page',()=>this.schedule());
  const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>/^app:\/\/-\/index\.html(?:\?|$)/.test(p.url())&&!p.url().includes('initialRoute='));if(pages.length!==1)throw Error('等待唯一桌面主窗口');const page=pages[0];this.page=page;
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())this.schedule();});page.on('close',()=>{this.page=null;this.schedule();});return page;
  })().catch(e=>{this.schedule();throw e;}).finally(()=>{this.connecting=null;});return this.connecting;
 }
 async apply(id:string,source:string,generation:number){const page=await this.attach();const ready=await page.evaluate(()=>document.readyState!=='loading'&&!!(window as unknown as {electronBridge?:unknown}).electronBridge);if(!ready){this.schedule();throw Error('等待桌面 bridge 就绪');}return await page.evaluate<{cleanupError?:string}|undefined>(pluginRuntimeScript(id,source,generation));}
 async dispose(id:string,generation:number){if(this.page&&!this.page.isClosed())await this.page.evaluate(pluginRuntimeScript(id,null,generation));}
 async close(){this.closed=true;if(this.retry)clearTimeout(this.retry);await this.connecting?.catch(()=>{});await this.browser?.close().catch(()=>{});this.page=null;this.browser=null;}
}
export class ScriptPluginHost {
 readonly directory:string;private stateFile:string;private plugins:ScriptPlugin[]=[];private sources=new Map<string,string>();private enabled=new Set<string>();private useDefaults=false;private endpoint:string|null=null;private transport:PluginTransport|null=null;private generation=Date.now()*1000;private saving:Promise<unknown>=Promise.resolve();private attempts=new Map<string,{generation:number;enabled:boolean}>();private cleanupErrors=new Map<string,string>();private templateErrors:ScriptPlugin[]=[];
 constructor(configFile:string,private packageRoot:string,private factory:PluginTransportFactory=(endpoint,refresh)=>new CdpPluginTransport(endpoint,refresh)){this.directory=join(dirname(configFile),'plugins');this.stateFile=join(dirname(configFile),'plugins.json');}
 async initialize(){
  await mkdir(this.directory,{recursive:true});
  const template=join(this.packageRoot,'plugins');
  if(resolve(template)!==resolve(this.directory)){
   // 缺少模板目录兼容开发/测试；其他读取失败必须可见。
   let directories:import('node:fs').Dirent[]=[];
   try{directories=await readdir(template,{withFileTypes:true});}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')this.templateError('_templates',template,e);}
   for(const dir of directories){
    if(!dir.isDirectory())continue;
    const dest=join(this.directory,dir.name);let staging:string|undefined;
    try{
     try{await lstat(dest);continue;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
     staging=await mkdtemp(join(dirname(this.directory),'.plugin-template-'));
     await copyTemplateFiles(join(template,dir.name),staging);
     try{await lstat(dest);continue;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
     await rename(staging,dest);staging=undefined;
    }catch(e){this.templateError(dir.name,dest,e);}finally{if(staging)await rm(staging,{recursive:true,force:true}).catch(()=>{});}
   }
  }
  this.useDefaults=false;try{const saved=JSON.parse(await readFile(this.stateFile,'utf8'));if(!Array.isArray(saved.enabled)||saved.enabled.some((x:unknown)=>typeof x!=='string'))throw Error('plugins.json 的 enabled 必须是字符串数组');this.enabled=new Set(saved.enabled);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT'){await this.scan();this.plugins.push({id:'_settings',name:'插件设置',description:'',version:'',enabled:false,state:'error',error:message(e),path:this.stateFile});return this.list();}this.useDefaults=true;}await this.scan();return this.list();}
 private templateError(id:string,path:string,error:unknown){this.templateErrors.push({id,name:id,description:'',version:'',enabled:false,state:'error',error:'模板复制失败: '+message(error),path});}
 list():ScriptPluginList{return {directory:this.directory,plugins:[...this.plugins,...this.templateErrors].map(p=>({...p}))};}
 private async scan(){this.plugins=[];this.sources.clear();const ids=new Map<string,ScriptPlugin>();for(const dir of await readdir(this.directory,{withFileTypes:true})){if(!dir.isDirectory()&&!dir.isSymbolicLink())continue;const path=join(this.directory,dir.name);const item:ScriptPlugin={id:dir.name,name:dir.name,description:'',version:'',enabled:this.enabled.has(dir.name),state:'inactive',path};try{
 if(dir.isSymbolicLink())throw Error('插件目录不能是符号链接');const manifestPath=join(path,'manifest.json');if((await lstat(manifestPath)).isSymbolicLink()||(await stat(manifestPath)).size>65536)throw Error('manifest 路径或大小无效');const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 if(typeof manifest.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(manifest.id))throw Error('无效插件 ID');Object.assign(item,{id:manifest.id,name:typeof manifest.name==='string'?manifest.name:manifest.id,description:typeof manifest.description==='string'?manifest.description:'',version:typeof manifest.version==='string'?manifest.version:'',enabled:this.enabled.has(manifest.id)});
 if(ids.has(item.id)){const first=ids.get(item.id)!;first.state='error';first.error='重复插件 ID';this.sources.delete(item.id);throw Error('重复插件 ID');}ids.set(item.id,item);
 const entry=manifest.entry;if(typeof entry!=='string'||isAbsolute(entry)||entry.split(/[\\/]/).includes('..'))throw Error('插件入口路径无效');const actual=await realpath(join(path,entry));const rel=relative(await realpath(path),actual);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('插件入口路径逃逸');const info=await stat(actual);if(!info.isFile()||info.size>limit)throw Error('插件入口文件过大或不是文件');const source=await readFile(actual,'utf8');this.sources.set(item.id,source);if(this.useDefaults&&manifest.defaultEnabled===true){this.enabled.add(item.id);item.enabled=true;}item.state=item.enabled?'waiting':'inactive';item.error=this.cleanupErrors.get(item.id);
 }catch(e){item.state='error';item.error=message(e);}this.plugins.push(item);}}
 async setEnabled(id:string,enabled:boolean){
  if(typeof id!=='string'||typeof enabled!=='boolean')throw Error('插件开关参数无效');
  const saving=this.saving.catch(()=>{}).then(async()=>{
   const item=this.plugins.find(p=>p.id===id);if(!item)throw Error('未知插件');if(enabled&&!this.sources.has(id))throw Error(item.error??'插件无效');
   const next=new Set(this.enabled);if(enabled)next.add(id);else next.delete(id);
   await writeFile(this.stateFile+'.tmp',JSON.stringify({enabled:[...next]},null,2)+'\n',{mode:0o600});await rename(this.stateFile+'.tmp',this.stateFile);
   this.enabled=next;this.useDefaults=false;for(const p of this.plugins)if(p.id===id)p.enabled=enabled;
  });this.saving=saving;await saving;await this.reconcile();return this.list();
 }

 async reload(){await this.unload();await this.scan();await this.reconcile();return this.list();}
 async bind(endpoint:string|null){this.endpoint=endpoint;await this.unload();await this.reconcile();return this.list();}
 private async unload(){
  const transport=this.transport;this.transport=null;this.attempts.clear();const generation=++this.generation;
  for(const p of this.plugins)if(this.sources.has(p.id)&&!p.error?.startsWith('插件清理')){p.state=p.enabled?'waiting':'inactive';delete p.error;}
  if(transport){await Promise.all(this.plugins.map(async p=>{try{await deadline(transport.dispose(p.id,generation),'插件清理超时');}catch(e){p.state='error';p.error='插件清理失败: '+message(e);this.cleanupErrors.set(p.id,p.error);}}));try{await deadline(transport.close(),'插件连接关闭超时');}catch(e){for(const p of this.plugins)if(p.enabled){p.state='error';p.error='插件清理失败: '+message(e);this.cleanupErrors.set(p.id,p.error);}}}
 }

 private async reconcile(force=false){
  const enabled=this.plugins.filter(p=>p.enabled&&this.sources.has(p.id));if(!this.endpoint||!enabled.length){await this.unload();return;}
  if(!this.transport){const created=this.factory(this.endpoint,()=>{if(this.transport===created)void this.reconcile(true);});this.transport=created;}
  const transport=this.transport;
  await Promise.all(this.plugins.map(async p=>{
   if(!this.sources.has(p.id))return;
   if(p.enabled&&!force&&this.attempts.get(p.id)?.enabled===true)return;
   const generation=++this.generation;this.attempts.set(p.id,{generation,enabled:p.enabled});
   const current=()=>this.transport===transport&&this.attempts.get(p.id)?.generation===generation;
   try{
    if(!p.enabled){await deadline(transport.dispose(p.id,generation),'插件清理超时');if(current()){this.attempts.delete(p.id);p.state='inactive';p.error=this.cleanupErrors.get(p.id);}return;}
    p.state='waiting';const result=await transport.apply(p.id,this.sources.get(p.id)!,generation);
    if(current()&&p.enabled){p.state='active';if(result?.cleanupError)this.cleanupErrors.set(p.id,'插件清理失败: '+result.cleanupError);p.error=this.cleanupErrors.get(p.id);}
   }catch(e){if(current()){this.attempts.delete(p.id);p.error=message(e);if(!p.enabled)this.cleanupErrors.set(p.id,p.error);p.state=p.error.startsWith('等待')?'waiting':'error';}}
  }));
 }
}
