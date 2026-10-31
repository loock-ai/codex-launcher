// 只发现桌面已加载的模块，按能力复用已初始化服务；旧映射仅作兼容提示。
const resolveDotsRuntimeScript = String.raw`async ({contract,timeoutMs})=>{
 const resolve=async()=>{
  const bridge=window.electronBridge,version=bridge?.getSentryInitOptions?.()?.appVersion??bridge?.getAppVersion?.();
  const hint=[contract,...(contract?.compatibleContracts??[])].find(candidate=>candidate?.version===version);
  const base=new URL(location.href),urls=new Set();
  const resources=typeof performance!=='undefined'&&typeof performance.getEntriesByType==='function'?performance.getEntriesByType('resource').map(entry=>entry.name):[];
  const elements=typeof document!=='undefined'?Array.from(document.querySelectorAll('script[type="module"][src],link[rel="modulepreload"][href]')):[];
  for(const raw of [...resources,...elements.map(entry=>entry.src||entry.href)])try{
   const url=new URL(raw,base);
   if(url.protocol===base.protocol&&url.host===base.host&&url.pathname.startsWith(new URL('./assets/',base).pathname)&&/\/(app-shared|app-initial)-[^/]+\.js$/.test(url.pathname)&&!url.search&&!url.hash)urls.add(url.href);
  }catch{}
  const hintUrl=hint?new URL(hint.module,base).href:null;
  // 仅历史已核对映射可在没有DOM资源记录时回退；未知版本不会导入猜测的资源。
  if(!urls.size&&hintUrl)urls.add(hintUrl);
  // 新版桌面清理了部分资源计时记录；仅使用当前版本已静态和运行时核对的API模块。
  if(hint?.apiModule)urls.add(new URL(hint.apiModule,base).href);
  if(urls.size>16)throw Error('无法唯一识别桌面 Dots 模块');
  const services=new Set(),apis=new Set();
  for(const url of urls){
   let module;try{module=await import(url);}catch{continue;}
   for(const [key,value] of Object.entries(module)){
    if(!value||typeof value!=='object')continue;
    try{
     if(typeof value.httpFetch?.fetch==='function'&&typeof value.httpFetch?.cancel==='function'&&typeof value.accessInputs?.readAccountInfo==='function')services.add(value);
     if(typeof value.getRequestTarget==='function'){
      const known=url===hintUrl&&key===hint.apiExport;
      const target=value.getRequestTarget('/tbo/primary'),headers=target?.headers;
      if(known||target?.url==='/tbo/primary'&&headers?.originator==='Codex Desktop'&&headers?.['x-openai-web-frontend']==='codex_webview')apis.add(value);
     }
    }catch{}
   }
  }
  if(services.size>1||apis.size>1)throw Error('无法唯一识别桌面 Dots 服务或原生 API');
  if(!services.size)throw Error('桌面 AppHost HTTP 服务或账号身份服务尚未就绪');
  if(!apis.size)throw Error('桌面原生 Dots API 尚未就绪');
  return {services:[...services][0],api:[...apis][0]};
 };
 let timer;try{return await Promise.race([resolve(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Dots service discovery timed out')),timeoutMs);})]);}finally{clearTimeout(timer);}
}`;

// Browser-side scripts remain literal so SSR tooling cannot rewrite dynamic import.
export const dotsStatusScript = String.raw`async ({contract,timeoutMs})=>{
    let runtime;try{runtime=await (${resolveDotsRuntimeScript})({contract,timeoutMs});}catch(error){return {available:false,error:error.message};}
    const access=runtime.services.accessInputs;
    let timer;let snapshot;try{snapshot=await Promise.race([access.readAccountInfo(true),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Dots identity timed out')),timeoutMs);})]);}finally{clearTimeout(timer);}
    const data=snapshot?.data;
    if(snapshot?.status!=='ready'||typeof data?.accountId!=='string'||!data.accountId||typeof data?.userId!=='string'||!data.userId)return {available:false,error:'请先在桌面登录 ChatGPT',code:'DOTS_AUTH_UNAVAILABLE'};
    return {available:true,identity:{accountId:data.accountId,userId:data.userId}};

}`;

export const dotsRequestScript = String.raw`async ({request,contract,limit,identity,timeoutMs})=>{
   const {services,api}=await (${resolveDotsRuntimeScript})({contract,timeoutMs});
   const http=services.httpFetch;
   const sameAccount=async()=>{const state=await services.accessInputs.readAccountInfo(true);return state?.status==='ready'&&state.data?.accountId===identity.accountId&&state.data?.userId===identity.userId;};
   const accountChanged={status:409,body:null,accountChanged:true};
   if(!http)throw new Error('Dots AppHost service unavailable');
   const id=crypto.randomUUID();
   const nativeHeaders=api.getRequestTarget(request.path).headers;
   const voice=/^\/tbo\/[^/]+\/voice\/calls(?:\/[^/]+\/(?:attach|stop))?$/.test(request.path);
   const headers={...nativeHeaders,
    'Content-Type':'application/json','X-OpenAI-Attach-Auth':'1',
    'ChatGPT-Account-Id':identity.accountId,'X-OpenAI-Expected-Account-Id':identity.accountId,
    'X-OpenAI-Attach-Desktop-Surface':'1','X-OpenAI-Attach-Integrity-State':'1',
    'x-openai-web-frontend':'codex_webview','x-openai-codex-window-type':'electron',
   };
   if(request.method==='POST'&&!voice)headers['X-OpenAI-Attach-DeviceCheck-Token']='1';
   let requestBody=request.body===undefined?undefined:JSON.stringify(request.body);
   if(request.method==='POST'&&request.path.endsWith('/files')){
    const file=request.body?.file;
    if(!file||typeof file.name!=='string'||typeof file.type!=='string'||!/^[-\w.+]+\/[-\w.+]+$/.test(file.type)||typeof file.base64!=='string')throw new Error('Dots invalid upload');
    const boundary='----codex-upload-'+crypto.randomUUID(),encoder=new TextEncoder();
    const bytes=Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));
    const filename=file.name.replace(/[\r\n"]/g,'')||'upload';
    const head=encoder.encode('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+filename+'"\r\nContent-Type: '+file.type+'\r\n\r\n');
    const tail=encoder.encode('\r\n--'+boundary+'--\r\n');
    requestBody=new Uint8Array(head.length+bytes.length+tail.length);requestBody.set(head);requestBody.set(bytes,head.length);requestBody.set(tail,head.length+bytes.length);
    for(const key of Object.keys(headers))if(key.toLowerCase()==='content-type')delete headers[key];
    headers['Content-Type']='multipart/form-data; boundary='+boundary;
   }
   let pending,result,timer,finished=false;
   try{
    const operation=(async()=>{
     const current=await sameAccount();
     if(finished)throw new Error('Dots request no longer active');
     if(!current)return accountChanged;
     pending=http.fetch(id,{url:request.path,method:request.method,headers,body:requestBody,retry:'never',returnErrorResponse:true,expectedIdentity:identity});
     result=await pending;
     if(finished){result?.[Symbol.dispose]?.();throw new Error('Dots request no longer active');}
     if(!result?.response){
      // 主机在实际发送前拒绝不适用的设备校验标记，此时确定没有创建通话。
      const preflightRejected=result?.responseStatus===null&&result?.status===400&&result?.error==='Refusing to attach DeviceCheck token to unexpected URL';
      const status=result?.responseStatus??(preflightRejected?400:undefined);
      if(Number.isInteger(status)&&status>=400&&status<500&&status!==408&&status!==499)return await sameAccount()?{status,body:{error:'桌面拒绝了 Dots 请求，请检查登录、账户权限或设备验证'}}:accountChanged;
      throw new Error('Dots HTTP transport failed');
     }
     const response=result.response,reader=response.body?.getReader();let size=0,text='';const decoder=new TextDecoder();
     if(reader){try{for(;;){const {done,value}=await reader.read();if(finished)throw new Error('Dots request no longer active');if(done)break;size+=value.byteLength;if(size>limit)throw new Error('Dots response exceeds size limit');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
     let body=null;if(voice)body=text;else if(text){try{body=JSON.parse(text);}catch{throw new Error('Dots returned invalid JSON');}}
     if(!await sameAccount())return accountChanged;
     if(voice){
      const headers={};for(const key of ['location','openai-root-thread-id']){const value=response.headers.get(key);if(value!==null)headers[key]=value;}
      return {status:response.status,body,headers};
     }
     return {status:response.status,body};
    })();
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Dots request timed out')),timeoutMs);});
    return await Promise.race([operation,deadline]);
   }finally{
    finished=true;clearTimeout(timer);void http.cancel(id).catch(()=>{});
    result?.[Symbol.dispose]?.();pending?.[Symbol.dispose]?.();
   }

}`;
