import {randomBytes} from 'node:crypto';
import {networkInterfaces,hostname} from 'node:os';
import {join} from 'node:path';
import QRCode from 'qrcode';
import {createGateway} from '../../server/gateway.js';
import {createControlGateway} from '../../server/cdp/control-gateway.js';
import {ControlError,type DesktopControlChannel,type ControlEvent} from '../../server/cdp/control-channel.js';
import {DotsAdapter} from '../../server/dots/adapter.js';
import {DotsError} from '../../server/dots/types.js';
import {startManagedAppServer} from '../../server/app-server-manager.js';

interface Config {mode:'cdp'|'managed'|'external';gatewayPort:number;appServerPort:number;host:'127.0.0.1'|'0.0.0.0';token:string;upstreamUrl:string}
interface Context {pluginDir:string;dataDir:string;signal:AbortSignal;config:{read(defaults:Config):Promise<Config>;write(config:Config):Promise<unknown>};actions:{register(name:string,handler:(params:any)=>unknown):void};host:{call(method:string,params?:any):Promise<any>;subscribe(listener:(event:any)=>void):()=>void};status:{publish(status:any):void};onDispose(fn:()=>unknown):void;log(message:string):void}
const defaults=():Config=>({mode:'cdp',gatewayPort:19877,appServerPort:19876,host:'0.0.0.0',token:randomBytes(24).toString('hex'),upstreamUrl:'ws://127.0.0.1:18765'});
function validate(c:Config):Config {
 if(!['cdp','managed','external'].includes(c.mode))throw new Error('连接模式无效');
 if(![c.gatewayPort,c.appServerPort].every(p=>Number.isInteger(p)&&p>0&&p<65536)||c.gatewayPort===c.appServerPort)throw new Error('端口必须是不同的 1 到 65535 整数');
 if(!['127.0.0.1','0.0.0.0'].includes(c.host))throw new Error('监听地址无效');
 if(typeof c.token!=='string'||c.token.length<16||c.token.length>256)throw new Error('访问口令需要 16 到 256 个字符');
 const u=new URL(c.upstreamUrl);if(!['ws:','wss:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.hash)throw new Error('上游必须是本机 WebSocket 地址');
 return {mode:c.mode,gatewayPort:c.gatewayPort,appServerPort:c.appServerPort,host:c.host,token:c.token,upstreamUrl:c.upstreamUrl};
}
async function controlProxy(ctx:Context,leaseId:string){
 let status=await ctx.host.call('desktop.control.status',{leaseId}),pending:ControlEvent[]=await ctx.host.call('desktop.control.pendingApprovals',{leaseId}),closed=false;
 const listeners=new Set<(event:ControlEvent)=>void>();
 const call=async(method:string,params:any={})=>{try{return await ctx.host.call('desktop.control.'+method,{leaseId,...params});}catch(error:any){throw new ControlError(error.code??'DESKTOP_UNAVAILABLE',error.message);}};
 const unsubscribe=ctx.host.subscribe(message=>{if(message.type!=='desktop.event'||message.leaseId!==leaseId)return;const event=message.event as ControlEvent;
 if(event.method==='desktop/disconnected')status={...status,connected:false};
 if(event.id!==undefined){pending=pending.filter(p=>p.id!==event.id);pending.push(event);}if(event.method==='desktop/approval/resolved')pending=pending.filter(p=>p.id!==event.params?.id);
 for(const fn of listeners)fn(event);
 });
 return {connect:async()=>{},status:()=>status,pendingApprovals:()=>pending,hosts:()=>call('hosts'),request:(hostId:string,method:string,params:any,timeoutMs?:number)=>call('request',{hostId,method,params,timeoutMs}),respond:async(approvalId:string|number,result:unknown)=>{const value=await call('respond',{approvalId,result});pending=pending.filter(p=>p.id!==approvalId);return value;},subscribe:(fn:(event:ControlEvent)=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);},setUserQuestionTargets:(targets:unknown)=>{void call('setUserQuestionTargets',{targets}).catch(e=>ctx.log(e.message));},refreshUserQuestions:async(targets:unknown)=>{await call('refreshUserQuestions',{targets});pending=await call('pendingApprovals');status=await call('status');},close:async()=>{if(closed)return;closed=true;unsubscribe();listeners.clear();await ctx.host.call('desktop.release',{leaseId});}} as unknown as DesktopControlChannel;
}
export async function activate(ctx:Context){
 let config=validate(await ctx.config.read(defaults()));
 await ctx.config.write(config);
 let state='stopped',error='',clients=0,approvals=0,port=config.gatewayPort;
 let service:{close():Promise<void>;port:number}|undefined,managed:Awaited<ReturnType<typeof startManagedAppServer>>|undefined,channel:DesktopControlChannel|undefined;
 const logs:string[]=[];
 const log=(message:string)=>{logs.push(`${new Date().toISOString()} ${message}`);if(logs.length>200)logs.shift();ctx.log(message);};
 const getStatus=()=>({state,mode:config.mode,clients,approvals,error,port});
 const publish=()=>ctx.status.publish(getStatus());
 const safeConfig=()=>({...config,token:'',hasToken:!!config.token});
 let queue:Promise<unknown>=Promise.resolve();
 const serial=<T>(fn:()=>Promise<T>):Promise<T>=>{const task=queue.then(fn,fn);queue=task.catch(()=>{});return task;};
 const close=async()=>{const s=service,m=managed,c=channel;service=undefined;managed=undefined;channel=undefined;try{await s?.close();}finally{try{await c?.close();}finally{await m?.close();}}clients=0;approvals=0;};
 const stop=()=>serial(async()=>{state='stopping';publish();try{await close();state='stopped';error='';log('Mobile 已停止');}catch(e:any){state='error';error=e.message;throw e;}finally{publish();}});
 const start=()=>serial(async()=>{
 if(service&&state!=='waiting')return getStatus();if(service)await close();if(ctx.signal.aborted)throw new Error('插件已卸载');state='starting';error='';publish();
 try{
  if(config.mode==='cdp'){
   const {leaseId}=await ctx.host.call('desktop.acquire');
   try{channel=await controlProxy(ctx,leaseId);}catch(e){await ctx.host.call('desktop.release',{leaseId});throw e;}
   const dots=new DotsAdapter({status:()=>ctx.host.call('desktop.dots.status',{leaseId}),request:async(request)=>{try{return await ctx.host.call('desktop.dots.request',{leaseId,request});}catch(e:any){throw new DotsError(e.code??'DOTS_UNAVAILABLE',e.message);}},close:async()=>{}});
   service=await createControlGateway({channel,dots,host:config.host,port:config.gatewayPort,token:config.token,staticDir:join(ctx.pluginDir,'web'),onStatus:s=>{clients=s.clients;approvals=s.approvals;error=s.error;if(!s.connected&&s.error)state='waiting';publish();}});
  }else{
   const upstream=config.mode==='managed'?`ws://127.0.0.1:${config.appServerPort}`:config.upstreamUrl;
   if(config.mode==='managed'){const details=await ctx.host.call('desktop.details');managed=await startManagedAppServer(config.appServerPort,details.cliPath);const child=managed;void child.exited.then(code=>{if(managed===child){void serial(async()=>{await close();state='error';error=`app-server 意外退出：${code}`;publish();});}});}
   service=await createGateway({host:config.host,port:config.gatewayPort,mode:config.mode,upstreamUrl:upstream,staticDir:join(ctx.pluginDir,'web'),accessToken:config.token,uploadDir:join(ctx.dataDir,'uploads'),hostId:hostname(),displayName:'Codex Mobile',onClientCount:count=>{clients=count;publish();},appServerReady:async()=>{try{const url=new URL(upstream);url.protocol=url.protocol==='wss:'?'https:':'http:';url.pathname='/readyz';return (await fetch(url,{signal:AbortSignal.timeout(2000)})).ok;}catch{return false;}}});
  }
  port=service.port;state='running';log(`Mobile 已启动（${config.mode}，端口 ${port}）`);publish();return getStatus();
 }catch(e:any){await close().catch(()=>{});state='error';error=e.message;log(error);publish();throw e;}
 });
 const urls=()=>{const address=config.host==='127.0.0.1'?'127.0.0.1':Object.values(networkInterfaces()).flatMap(n=>n??[]).filter(n=>n.family==='IPv4'&&!n.internal).sort((a,b)=>Number(!a.address.startsWith('192.168.'))-Number(!b.address.startsWith('192.168.')))[0]?.address??'127.0.0.1';const suffix=`:${port}/?token=${encodeURIComponent(config.token)}`;return {accessUrl:`http://${address}${suffix}`,localUrl:`http://127.0.0.1${suffix}`};};
 const register=ctx.actions.register.bind(ctx.actions);
 register('status.get',getStatus);register('logs.read',()=>[...logs]);register('config.read',safeConfig);
 register('config.save',input=>serial(async()=>{if(service||state==='starting')throw new Error('请先停止 Mobile，再修改配置');if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('配置格式无效');const next=validate({...config,...input,token:input.token||config.token});await ctx.config.write(next);config=next;port=config.gatewayPort;publish();return safeConfig();}));
 register('connection.read',async()=>{const u=urls();return {...u,qrDataUrl:await QRCode.toDataURL(u.accessUrl,{width:240,margin:2}),desktop:await ctx.host.call('desktop.details')};});
 register('open-web',async()=>{await start();await ctx.host.call('system.openExternal',{url:urls().localUrl});return {opened:true};});
 register('copy-url',async()=>{await ctx.host.call('clipboard.writeText',{text:urls().accessUrl});return {copied:true};});
 register('approvals.list',()=>channel?.pendingApprovals()??[]);
 register('approvals.respond',async input=>{if(!channel)throw new Error('Desktop 控制通道未启动');await channel.respond(input.approvalId,input.result);return {submitted:true};});
 ctx.onDispose(stop);publish();return {start,stop,getStatus,deactivate:stop};
}
