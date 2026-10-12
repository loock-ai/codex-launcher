import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {DesktopControlChannel,type UserQuestionTarget} from '../cdp/control-channel.js';
import {CdpControlTransport} from '../cdp/control-transport.js';
import {CdpDesktopHttpTransport} from '../dots/desktop-transport.js';
import type {DesktopHttpTransport} from '../dots/types.js';
import {CdpPluginTransport,type PluginTransport,type PluginTransportFactory} from './script-plugins.js';
import {discoverDesktopCli} from './config.js';
import {forceStopDesktop,runningDesktopProcessIds} from './desktop-process.js';
import {desktopExecutable,systemOpenCommand,runPlatformCommand} from './platform.js';
import {appServerEnvironment} from '../app-server-manager.js';
import type {DesktopSettings} from './plugin-contract.js';
function readinessError(error:unknown){const message=error instanceof Error?error.message:String(error);return /无法唯一识别桌面主窗口|桌面未暴露 electronBridge|等待唯一桌面主窗口|等待桌面 bridge 就绪/.test(message)?Object.assign(Error(message),{code:'DESKTOP_NOT_READY'}):error;}
type Channel=Pick<DesktopControlChannel,'connect'|'close'|'subscribe'|'status'|'request'|'hosts'|'pendingApprovals'|'respond'|'setUserQuestionTargets'|'refreshUserQuestions'>;
export interface DesktopServiceDeps {
 createChannel?:(endpoint:string)=>Channel;createDots?:(endpoint:string)=>DesktopHttpTransport;pluginTransport?:PluginTransportFactory;
 ensure?:(settings:DesktopSettings)=>Promise<void>;open?:(settings:DesktopSettings)=>Promise<void>;restart?:(settings:DesktopSettings)=>Promise<void>;
 onEvent?:(pluginId:string,event:unknown)=>void;onChange?:()=>void;
}
interface Injection {leaseId:string;transport:PluginTransport;generation:number;source:string;}
export class DesktopService {
 private channel:Channel|null=null;private dots:DesktopHttpTransport|null=null;private unsubscribe?:()=>void;
 private leases=new Map<string,string>();private targets=new Map<string,UserQuestionTarget[]>();private injections=new Map<string,Injection>();
 private queue:Promise<unknown>=Promise.resolve();private generation=Date.now()*1000;private error='';
 constructor(private settings:DesktopSettings,private deps:DesktopServiceDeps={}){}
 private serial<T>(fn:()=>Promise<T>){const result=this.queue.then(fn,fn);this.queue=result.catch(()=>{});return result;}
 private endpoint(){return `http://127.0.0.1:${this.settings.cdpPort}`;}
 status(){return {...this.settings,connected:this.channel?.status().connected??false,consumers:this.leases.size,error:this.error};}
 details(){let cliPath='';try{cliPath=discoverDesktopCli(this.settings.appPath);}catch{}return {...this.settings,cliPath};}
 updateSettings(settings:DesktopSettings){if(this.leases.size)throw Error('请先停止使用桌面的插件');this.settings=settings;this.deps.onChange?.();}
 async open(){if(this.deps.open)return this.deps.open(this.settings);await runPlatformCommand(systemOpenCommand(this.settings.appPath));}
 private async ready(){try{const r=await fetch(this.endpoint()+'/json/version',{signal:AbortSignal.timeout(1200)});return r.ok&&typeof (await r.json()).webSocketDebuggerUrl==='string';}catch{return false;}}
 private async launch(){const executable=desktopExecutable(this.settings.appPath);await access(executable);const env=appServerEnvironment(process.env);delete env.CODEX_APP_SERVER_WS_URL;delete env.CODEX_APP_SERVER_FORCE_CLI;delete env.ELECTRON_RUN_AS_NODE;const child=spawn(executable,[`--remote-debugging-port=${this.settings.cdpPort}`,'--remote-debugging-address=127.0.0.1'],{env,detached:true,stdio:'ignore'});await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();const end=Date.now()+15000;while(Date.now()<end){if(await this.ready())return;await new Promise(r=>setTimeout(r,200));}throw Error('桌面 CDP 未就绪');}
 async ensure(){try{if(this.deps.ensure)await this.deps.ensure(this.settings);else if(!await this.ready()){if((await runningDesktopProcessIds(desktopExecutable(this.settings.appPath))).length)throw Error('桌面正在运行但未开启 CDP，请点击重启并连接');await this.launch();}this.error='';}catch(e){this.error=e instanceof Error?e.message:String(e);throw Object.assign(Error(this.error),{code:'DESKTOP_NOT_READY'});}finally{this.deps.onChange?.();}}
 async restart(){if(this.leases.size)throw Error('请先停止使用桌面的插件');if(this.deps.restart)await this.deps.restart(this.settings);else{await forceStopDesktop(desktopExecutable(this.settings.appPath));await this.launch();}this.error='';this.deps.onChange?.();}
 private async acquire(owner:string){await this.ensure();if(this.channel&&!this.channel.status().connected){const old=this.channel;this.channel=null;this.unsubscribe?.();this.unsubscribe=undefined;await old.close().catch(()=>{});await this.dots?.close().catch(()=>{});this.dots=null;}if(!this.channel){const channel=this.deps.createChannel?.(this.endpoint())??new DesktopControlChannel(new CdpControlTransport(this.endpoint()));try{await channel.connect();}catch(e){await channel.close().catch(()=>{});throw readinessError(e);}this.channel=channel;this.unsubscribe=channel.subscribe(event=>{for(const [leaseId,pluginId] of this.leases)this.deps.onEvent?.(pluginId,{type:'desktop.event',leaseId,event});this.deps.onChange?.();});channel.setUserQuestionTargets(this.allTargets());}const leaseId=randomUUID();this.leases.set(leaseId,owner);this.deps.onChange?.();return {leaseId};}
 private check(owner:string,leaseId:unknown){if(typeof leaseId!=='string'||this.leases.get(leaseId)!==owner)throw Error('无效的桌面租约');return leaseId;}
 private allTargets(){return [...new Map([...this.targets.values()].flat().map(t=>[JSON.stringify([t.hostId,t.threadId]),t])).values()];}
 private async releaseLease(owner:string,id:string){this.check(owner,id);this.leases.delete(id);this.targets.delete(id);this.channel?.setUserQuestionTargets(this.allTargets());if(!this.leases.size){const c=this.channel,d=this.dots;this.channel=null;this.dots=null;this.unsubscribe?.();this.unsubscribe=undefined;await Promise.all([c?.close(),d?.close()]);}this.deps.onChange?.();}
 private async inject(owner:string,source:string){await this.uninject(owner);const {leaseId}=await this.acquire(owner);const record={} as Injection;const refresh=()=>{void this.serial(async()=>{if(this.injections.get(owner)!==record)return;try{await record.transport.apply(owner,record.source,record.generation);}catch(e){this.error=String(e);this.deps.onChange?.();}});};record.leaseId=leaseId;record.source=source;record.generation=++this.generation;record.transport=(this.deps.pluginTransport??((endpoint,fn)=>new CdpPluginTransport(endpoint,fn)))(this.endpoint(),refresh);this.injections.set(owner,record);try{const result=await record.transport.apply(owner,source,record.generation);if(result?.cleanupError)throw Error(result.cleanupError);}catch(e){await this.uninject(owner);throw readinessError(e);}}
 private async bounded(work:Promise<unknown>){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('桌面插件清理超时')),3000);})]);}finally{clearTimeout(timer);}}
 private async uninject(owner:string){const item=this.injections.get(owner);if(!item)return;this.injections.delete(owner);try{await this.bounded(item.transport.dispose(owner,++this.generation));}finally{try{await this.bounded(item.transport.close());}finally{await this.releaseLease(owner,item.leaseId);}}}
 async release(owner:string){return this.serial(async()=>{let error:unknown;try{await this.uninject(owner);}catch(e){error=e;}for(const [id,plugin] of this.leases)if(plugin===owner)await this.releaseLease(owner,id);if(error)throw error;});}
 async shutdown(){for(const owner of new Set(this.leases.values()))await this.release(owner);}
 async call(owner:string,method:string,raw:unknown={}){
  const p=(raw??{}) as any;
  if(method==='desktop.details')return this.details();
  if(method==='desktop.acquire')return this.serial(()=>this.acquire(owner));
  if(method==='desktop.release')return this.serial(()=>this.releaseLease(owner,this.check(owner,p.leaseId)));
  if(method==='desktop.inject'){if(typeof p.source!=='string')throw Error('无效注入脚本');return this.serial(()=>this.inject(owner,p.source));}
  if(method==='desktop.uninject')return this.serial(()=>this.uninject(owner));
  const leaseId=this.check(owner,p.leaseId),channel=this.channel!;
  switch(method){
   case 'desktop.control.status':return channel.status();
   case 'desktop.control.hosts':return channel.hosts();
   case 'desktop.control.pendingApprovals':return channel.pendingApprovals();
   case 'desktop.control.request':return channel.request(p.hostId,p.method,p.params,p.timeoutMs);
   case 'desktop.control.respond':return channel.respond(p.approvalId,p.result);
   case 'desktop.control.setUserQuestionTargets':case 'desktop.control.refreshUserQuestions':{
    if(!Array.isArray(p.targets)||p.targets.length>8||p.targets.some((t:any)=>typeof t?.hostId!=='string'||typeof t?.threadId!=='string'))throw Error('无效问题订阅');
    this.targets.set(leaseId,p.targets);const targets=this.allTargets();channel.setUserQuestionTargets(targets);if(method.endsWith('refreshUserQuestions'))await channel.refreshUserQuestions(targets);return;
   }
   case 'desktop.dots.status':case 'desktop.dots.request':this.dots??=this.deps.createDots?.(this.endpoint())??new CdpDesktopHttpTransport(this.endpoint());return method.endsWith('.status')?this.dots.status():this.dots.request(p.request);
   default:throw Error('不支持的桌面方法: '+method);
  }
 }
}
