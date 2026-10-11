import {DESKTOP_APP_HOST_CONTRACT} from '../cdp/app-host-contract.js';
import {validateDotsRequest} from './paths.js';
import {createHash} from 'node:crypto';
import {dotsStatusScript,dotsRequestScript} from './desktop-script.js';
import {chromium,type Browser,type Page} from 'playwright-core';
import {validateCdpUrl} from '../cdp/dom.js';
import {DotsError,type DesktopHttpRequest,type DesktopHttpTransport} from './types.js';

// 本构建的已初始化 AppHost services 导出；绝不调用 connect-app-host 再注册 AppView。
export const DOTS_DESKTOP_CONTRACT={...DESKTOP_APP_HOST_CONTRACT,compatibleContracts:[
 {version:'26.1007.30912',module:'./assets/app-shared-8bd9d0399038.js',servicesExport:'fN',apiExport:'$wt'},
]};
const responseLimit=16*1024*1024;

export class CdpDesktopHttpTransport implements DesktopHttpTransport {
 private browser:Browser|null=null;
 private page:Page|null=null;
 private connecting:Promise<Page>|null=null;
 private closed=false;
 private identity:{accountId:string;userId:string}|null=null;
 private accountChanged=false;
 constructor(private endpoint:string){validateCdpUrl(endpoint);}
 private async attach():Promise<Page>{
  if(this.closed)throw new DotsError('DOTS_UNAVAILABLE','Dots 桌面连接已关闭',503);
  if(this.page&&!this.page.isClosed()&&this.browser?.isConnected())return this.page;
  if(this.connecting)return this.connecting;
  this.connecting=(async()=>{
   await this.browser?.close().catch(()=>{});this.browser=null;this.page=null;
   const browser=await chromium.connectOverCDP(validateCdpUrl(this.endpoint),{timeout:5000});
   if(this.closed){await browser.close();throw new DotsError('DOTS_UNAVAILABLE','Dots 桌面连接已关闭',503);}
   const pages=browser.contexts().flatMap(context=>context.pages()).filter(page=>/^app:\/\/-\/index\.html(?:\?|$)/.test(page.url())&&!page.url().includes('initialRoute='));
   if(pages.length!==1){await browser.close();throw new DotsError('DOTS_UNAVAILABLE','无法唯一识别 Dots 桌面主窗口',503);}
   this.browser=browser;this.page=pages[0];return this.page;
  })().finally(()=>{this.connecting=null;});
  return this.connecting;
 }
 async status(){
  try{
   const page=await this.attach();
   const state=await page.evaluate<{available:boolean;error?:string;code?:string;identity?:{accountId:string;userId:string}}>(`(${dotsStatusScript})(${JSON.stringify({contract:DOTS_DESKTOP_CONTRACT,timeoutMs:6000})})`);
   if(this.identity && (state.code==='DOTS_AUTH_UNAVAILABLE'||state.identity&&JSON.stringify(state.identity)!==JSON.stringify(this.identity)))this.accountChanged=true;
   if(this.accountChanged)return {available:false,code:'DOTS_ACCOUNT_CHANGED',error:'桌面账号已变化，请重启启动器后重新连接 Dots'};
   if(state.available&&state.identity)this.identity??=state.identity;
   return {available:state.available,...state.error?{error:state.error}:{},...state.available&&this.identity?{identityKey:createHash('sha256').update(JSON.stringify(this.identity)).digest('hex')}:{}};
  }catch{return {available:false,error:'无法连接 Dots 桌面服务，请确认桌面与 CDP 已启动'};}
 }
 async request(request:DesktopHttpRequest){
  validateDotsRequest(request);
  const state=await this.status();if(!state.available)throw new DotsError(state.code??'DOTS_UNAVAILABLE',state.error??'Dots 服务不可用',state.code==='DOTS_ACCOUNT_CHANGED'?409:503);
  const page=this.page!;
  const result=await page.evaluate<{status:number;body:unknown;accountChanged?:boolean}>(`(${dotsRequestScript})(${JSON.stringify({request,contract:DOTS_DESKTOP_CONTRACT,limit:responseLimit,identity:this.identity,timeoutMs:request.method==='POST'?30000:12000})})`);
  if(result.accountChanged){this.accountChanged=true;throw new DotsError('DOTS_ACCOUNT_CHANGED','桌面账号已变化，请重启启动器后重新连接 Dots',409);}
  return {status:result.status,body:result.body};
 }
 async close(){this.closed=true;await this.connecting?.catch(()=>{});await this.browser?.close().catch(()=>{});this.browser=null;this.page=null;}
}
