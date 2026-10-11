import {ScriptPluginHost,type PluginTransportFactory} from './script-plugins.js';
import {DotsAdapter} from '../dots/adapter.js';
import {CdpDesktopHttpTransport} from '../dots/desktop-transport.js';
import { EventEmitter } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname, networkInterfaces } from 'node:os';
import { loadConfig,saveConfig,validateConfig,discoverDesktopCli,type LauncherConfig } from './config.js';
import {forceStopDesktop} from './desktop-process.js';
import { DesktopControlChannel } from '../cdp/control-channel.js';
import { CdpControlTransport } from '../cdp/control-transport.js';
import { createControlGateway } from '../cdp/control-gateway.js';
import { createGateway } from '../gateway.js';
import { startManagedAppServer,appServerEnvironment } from '../app-server-manager.js';

const exec=promisify(execFile);
type Service={port:number;pluginEndpoint?:string|null;close():Promise<void>};
export interface LauncherStatus {config:LauncherConfig;running:boolean;phase:string;error:string;clients:number;approvals:number;thread:string;accessUrl:string|null;logs:string[]}
interface Dependencies {pluginTransport?:PluginTransportFactory;start?:(config:LauncherConfig)=>Promise<Service>;desktopRunning?:()=>Promise<boolean>;openDesktop?:(config:LauncherConfig)=>Promise<void>;forceStopDesktop?:(config:LauncherConfig)=>Promise<void>;launchDebugDesktop?:(config:LauncherConfig)=>Promise<void>;debugReady?:()=>Promise<boolean>}
export class LauncherController extends EventEmitter {
 private config!:LauncherConfig;private service:Service|null=null;private phase='未启动';private error='';private clients=0;private approvals=0;private thread='';private logs:string[]=[];private queue:Promise<unknown>=Promise.resolve();private timer:ReturnType<typeof setInterval>|null=null;
 private plugins:ScriptPluginHost;
 constructor(private configFile:string,private packageRoot:string,private deps:Dependencies={}){super();this.plugins=new ScriptPluginHost(configFile,packageRoot,deps.pluginTransport);}
 pluginDirectory(){return this.plugins.directory;}
 listPlugins(){return this.plugins.list();}
 setPluginEnabled(id:string,enabled:boolean){return this.plugins.setEnabled(id,enabled);}
 reloadPlugins(){return this.plugins.reload();}
 async initialize(){this.config=await loadConfig(this.configFile);await this.plugins.initialize();this.changed();return this.status();}
 private serialize<T>(action:()=>Promise<T>) {const p=this.queue.then(action,action);this.queue=p.catch(()=>{});return p;}
 private changed(){this.emit('status',this.status());}
 private log(text:string){this.logs=[...this.logs,new Date().toLocaleTimeString('zh-CN')+' '+text.replaceAll(this.config.token,'[口令]').slice(0,500)].slice(-40);this.changed();}
 status():LauncherStatus {
  const addresses=Object.values(networkInterfaces()).flatMap(x=>x??[]).filter(x=>x.family==='IPv4'&&!x.internal).sort((a,b)=>Number(!a.address.startsWith('192.168.'))-Number(!b.address.startsWith('192.168.')));
  const host=this.config?.host==='127.0.0.1'?'127.0.0.1':addresses[0]?.address??'127.0.0.1';
  const url=host&&this.service?new URL(`http://${host}:${this.service.port}/`):null;if(url)url.searchParams.set('token',this.config.token);
  return {config:this.config,running:!!this.service,phase:this.phase,error:this.error,clients:this.clients,approvals:this.approvals,thread:this.thread,accessUrl:url?.href??null,logs:[...this.logs]};
 }
 save(config:LauncherConfig){return this.serialize(async()=>{if(this.service)throw new Error('请先停止手机连接，再保存配置');const valid=validateConfig(config);await saveConfig(this.configFile,valid);this.config=valid;this.log('配置已保存');return this.status();});}
 private async desktopRunning(){if(this.deps.desktopRunning)return this.deps.desktopRunning();const {stdout}=await exec('/bin/ps',['-axo','comm='],{timeout:3000});return stdout.split('\n').some(s=>s.trim()===join(this.config.appPath,'Contents/MacOS/ChatGPT'));}
 async openDesktop(){if(this.deps.openDesktop)return this.deps.openDesktop(this.config);await exec('/usr/bin/open',[this.config.appPath],{timeout:5000});}
 private async launchDebugDesktop(){
  if(this.deps.launchDebugDesktop)return this.deps.launchDebugDesktop(this.config);
  const executable=join(this.config.appPath,'Contents/MacOS/ChatGPT');await access(executable);
  const env=appServerEnvironment(process.env);delete env.CODEX_APP_SERVER_WS_URL;delete env.CODEX_APP_SERVER_FORCE_CLI;delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(executable,[`--remote-debugging-port=${this.config.cdpPort}`,'--remote-debugging-address=127.0.0.1'],{env,detached:true,stdio:'ignore'});
  await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();
 }
 private async debugReady(){if(this.deps.debugReady)return this.deps.debugReady();try{const r=await fetch(`http://127.0.0.1:${this.config.cdpPort}/json/version`,{signal:AbortSignal.timeout(1200)});if(!r.ok)return false;const data=await r.json();return typeof data.webSocketDebuggerUrl==='string';}catch{return false;}}
 private async waitDebug(){const end=Date.now()+15000;while(Date.now()<end){if(await this.debugReady())return;await new Promise(r=>setTimeout(r,200));}throw new Error('ChatGPT 未开放 CDP，请使用重启并连接或检查桌面版本');}
 restartDesktop(){return this.serialize(async()=>{
  await this.stopInternal();this.phase='正在重启 ChatGPT';this.changed();
  try{
   if(this.deps.forceStopDesktop)await this.deps.forceStopDesktop(this.config);
   else await forceStopDesktop(join(this.config.appPath,'Contents/MacOS/ChatGPT'));
   await this.launchDebugDesktop();await this.waitDebug();this.log('ChatGPT 已强制重启并开启 CDP');return this.startInternal();
  }catch(error){this.phase='重启失败';this.error=error instanceof Error?error.message:String(error);this.log(this.error);throw error;}
 });}
 start(){return this.serialize(()=>this.startInternal());}
 private async startInternal(){
  if(this.service)return this.status();this.phase='正在连接';this.error='';this.changed();
  try {
   if(this.deps.start)this.service=await this.deps.start(this.config);
   else if(this.config.mode==='cdp'){
    if(!await this.debugReady()){if(await this.desktopRunning())throw new Error('ChatGPT 正在运行但未开启 CDP，请点击重启并连接');await this.launchDebugDesktop();await this.waitDebug();}
    const channel=new DesktopControlChannel(new CdpControlTransport(`http://127.0.0.1:${this.config.cdpPort}`));
    try{this.service=await createControlGateway({host:this.config.host,port:this.config.gatewayPort,token:this.config.token,staticDir:join(this.packageRoot,'dist'),channel,dots:new DotsAdapter(new CdpDesktopHttpTransport(`http://127.0.0.1:${this.config.cdpPort}`)),onStatus:s=>{this.clients=s.clients;this.approvals=s.approvals;this.error=s.error;if(!s.connected&&s.error)this.phase='桌面连接中断';this.changed();}});}catch(e){await channel.close();throw e;}
   }else{
    const managed=this.config.mode==='managed'?await startManagedAppServer(this.config.appServerPort,discoverDesktopCli(this.config.appPath)):null;
    const upstream=this.config.mode==='external'?this.config.upstreamUrl:`ws://127.0.0.1:${this.config.appServerPort}`;
    try{
     const gateway=await createGateway({host:this.config.host,port:this.config.gatewayPort,mode:this.config.mode==='managed'?'managed':'external',upstreamUrl:upstream,staticDir:join(this.packageRoot,'dist'),accessToken:this.config.token,hostId:hostname(),displayName:'Codex Mobile',onClientCount:count=>{this.clients=count;this.changed();},appServerReady:async()=>{try{const url=new URL(upstream);url.protocol=url.protocol==='wss:'?'https:':'http:';url.pathname='/readyz';const r=await fetch(url,{signal:AbortSignal.timeout(2000)});return r.ok;}catch{return false;}}});
     this.service={port:gateway.port,close:async()=>{await gateway.close();await managed?.close();}};
     if(managed)managed.exited.then(()=>{this.error='原 app-server 已退出';this.log(this.error);void this.stop();});
    }catch(error){await managed?.close();throw error;}
   }
   await this.plugins.bind(this.config.mode==='cdp'?(this.deps.start?this.service?.pluginEndpoint??null:`http://127.0.0.1:${this.config.cdpPort}`):null);
   this.phase='已启动';this.log(this.config.mode==='cdp'?'桌面控制通道与 Web 已启动':'原 Codex Mobile 已启动');return this.status();
  }catch(error){this.phase='连接失败';this.error=error instanceof Error?error.message:String(error);this.log(this.error);throw error;}
 }
 stop(){return this.serialize(async()=>{await this.stopInternal();return this.status();});}
 private async stopInternal(){await this.plugins.bind(null);const owned=this.service;this.service=null;await owned?.close();if(this.timer)clearInterval(this.timer);this.clients=0;this.approvals=0;this.thread='';this.error='';this.phase='未启动';this.changed();}
 async approve(_id:string,_choice:string){throw new Error('请在 Web 中打开对应会话处理审批');}
 async desktopStatus(){if(this.config.mode!=='cdp'||!this.service)return null;const channel=(this.service as Awaited<ReturnType<typeof createControlGateway>>).channel;return {...channel.status(),approvals:channel.pendingApprovals()};}
}
