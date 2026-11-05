import {randomUUID} from 'node:crypto';
import {chromium,type Browser,type Page} from 'playwright-core';
import {CdpControlTransport} from './control-transport.js';
import type {ControlTransport,UserQuestionTarget} from './control-channel.js';

/** 在桌面内取得本机原生 RPC。动态导入仅限本页已经声明的同源入口。 */
export async function openNativeManager(key:string,loadModule?:(url:string)=>Promise<Record<string,any>>){
 const w=window as any;
 if(w[key])throw Error('原生 API 句柄已存在');
 const refs:any[]=[];
 const state={refs,manager:null as any,closed:false,lost:false};w[key]=state;
 const track=(value:any)=>{if(value){if(state.closed){try{value?.[Symbol.dispose]?.();}catch{}}else refs.push(value);}return value;};
 try{
  const base=new URL(location.href);
  const entries=Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'),s=>s.src);
  const shared=performance.getEntriesByType('resource').map(r=>r.name).filter(url=>/\/app-shared-[^/]+\.js$/.test(new URL(url,base).pathname));
  let services:any;
  for(const raw of [...new Set([...entries,...shared])].slice(0,12)){
   const url=new URL(raw,base);
   if(url.protocol!==base.protocol||url.host!==base.host||!url.pathname.startsWith(new URL('./assets/',base).pathname)||url.search||url.hash)continue;
   const native=await (loadModule??(url=>import(/* @vite-ignore */ url)))(url.href);
   services=Object.values(native).find((value:any)=>value?.appServerManagers?.open);
   if(!services)for(const record of Object.values(native.__webpack_require__?.c??{}) as any[]){
    const exported=record?.exports;
    if(Object.hasOwn(exported??{},'setAppServices')&&exported.appServices?.appServerManagers){services=exported.appServices;break;}
   }
   if(services)break;
  }
  if(!services)throw Error('本机原生 AppServerManager API 不可用');
  const opening=track(services.appServerManagers.open('local'));
  const opened=track(await opening);
  const manager=track(opened.manager);
  if(state.closed)throw Error('原生 API 连接已关闭');
  if(opened.status!=='ready'||!manager)throw Error('本机 App Server 尚未就绪');
  state.manager=manager;manager.onRpcBroken?.(()=>{state.lost=true;});
 }catch(error){
  if(w[key]===state)delete w[key];state.closed=true;
  for(const ref of refs.splice(0).reverse())try{ref?.[Symbol.dispose]?.();}catch{}
  throw error;
 }
}
export function closeNativeManager(key:string){
 const w=window as any,state=w[key];delete w[key];if(state)state.closed=true;
 for(const ref of state?.refs?.splice(0).reverse()??[])try{ref?.[Symbol.dispose]?.();}catch{}
}

export async function sendNativeRequest({key,method,params}:{key:string;method:string;params:unknown}){
 const state=(window as any)[key];if(!state)throw Error('原生 API 句柄已失效');
 const pending=state.manager.sendRequest(method,params);
 try{return {result:await pending};}
 catch(error){
  const value=error as {jsonRpcCode?:number;message?:string;data?:unknown};
  if(typeof value.jsonRpcCode==='number')return {error:{code:value.jsonRpcCode,message:value.message??'原生 API 请求被拒绝',data:value.data}};
  throw error;
 }finally{try{pending?.[Symbol.dispose]?.();}catch{}}
}

/** 业务请求走原生管理器；CDP仅取得句柄及接收宿主已有通知。 */
export class NativeControlTransport implements ControlTransport{
 private base:CdpControlTransport;
 private browser?:Browser;
 private page?:Page;
 private key='__launcherNativeApi_'+randomUUID().replaceAll('-','');
 private listeners=new Set<(message:any)=>void>();
 private closed=false;
 private checking=false;private healthTimer?:ReturnType<typeof setInterval>;
 private unsubscribe?:()=>void;
 constructor(private endpoint:string){this.base=new CdpControlTransport(endpoint);}
 async connect(){
  try{
   await this.base.connect();
   if(this.closed){await this.base.close();throw Error('原生 API 连接已取消');}
   this.unsubscribe=this.base.subscribe(message=>this.deliver(message));
   this.browser=await chromium.connectOverCDP(this.endpoint,{timeout:5000});
   if(this.closed){await this.browser.close();throw Error('原生 API 连接已取消');}
   const pages=this.browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url()==='app://-/index.html');
   if(pages.length!==1)throw Error('无法唯一识别桌面主连接');
   this.page=pages[0];
   await this.bounded(this.page.evaluate(openNativeManager as (key:string)=>Promise<void>,this.key));
   if(this.closed)throw Error('原生 API 连接已关闭');
   this.healthTimer=setInterval(()=>{if(!this.checking){this.checking=true;void this.checkHealth().finally(()=>{this.checking=false;});}},1000);this.healthTimer.unref();
  }catch(error){await this.close();throw error;}
 }
 private async bounded<T>(work:Promise<T>,ms=5000):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('原生 API 响应超时')),ms);})]);}
  finally{clearTimeout(timer);}
 }
 private async checkHealth(){
  if(this.closed||!this.page)return;
  try{
   const healthy=await this.bounded(this.page.evaluate(key=>{const state=(window as any)[key];return !!state&&!state.lost;},this.key),2000);
   if(healthy)return;
  }catch{}
  this.deliver({type:'control-lost',reason:'本机原生 API 句柄已失效'});
  await this.close();
 }
 subscribe(fn:(message:any)=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn);};}
 private deliver(message:any){if(!this.closed)for(const fn of this.listeners)fn(message);}
 async send(message:any){
  if(this.closed||!this.page)throw Error('本机原生 API 连接已关闭');
  if(message.type!=='mcp-request'){await this.base.send(message);return;}
  if(message.hostId!=='local'){await this.base.send(message);return;}
  const request=message.request;
  try{
   const reply=await this.page.evaluate(sendNativeRequest,{key:this.key,method:request.method,params:request.params??{}});
   this.deliver({type:'mcp-response',hostId:'local',message:{id:request.id,...reply}});
  }catch(error){
   // 连接失效时由通道按写操作结果未知处理，禁止重放。
   throw error;
  }
 }
 readHosts(){return this.base.readHosts();}
 readUserQuestions(targets:UserQuestionTarget[]){return this.base.readUserQuestions(targets);}
 respondUserQuestion(hostId:string,request:any,result:unknown){return this.base.respondUserQuestion(hostId,request,result);}
 async close(){
  if(this.closed)return;this.closed=true;clearInterval(this.healthTimer);this.unsubscribe?.();
  if(this.page&&!this.page.isClosed())await this.bounded(this.page.evaluate(closeNativeManager,this.key),3000).catch(()=>{});
  try{await this.base.close();}finally{if(this.browser)await this.bounded(this.browser.close(),3000).catch(()=>{});this.listeners.clear();}
 }
}
