// Browser-side scripts remain literal so SSR tooling cannot rewrite dynamic import.
export const dotsStatusScript = String.raw`async ({contract,timeoutMs})=>{
    const bridge=window.electronBridge;
    const version=bridge?.getSentryInitOptions?.()?.appVersion??bridge?.getAppVersion?.();
    contract=[contract,...(contract.compatibleContracts??[])].find(candidate=>candidate.version===version);
    if(!contract)return {available:false,error:'此桌面版本尚未验证 Dots 通道（'+(version??'未知')+'）'};
    const module=await import(new URL(contract.module,location.href).href);
    const http=module[contract.servicesExport]?.httpFetch;
    if(!http||typeof http.fetch!=='function'||typeof http.cancel!=='function')return {available:false,error:'桌面 AppHost HTTP 服务尚未就绪'};
    const access=module[contract.servicesExport]?.accessInputs;
    if(typeof access?.readAccountInfo!=='function')return {available:false,error:'桌面缺少账号身份服务'};
    let timer;let snapshot;try{snapshot=await Promise.race([access.readAccountInfo(true),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Dots identity timed out')),timeoutMs);})]);}finally{clearTimeout(timer);}
    const data=snapshot?.data;
    if(snapshot?.status!=='ready'||typeof data?.accountId!=='string'||!data.accountId||typeof data?.userId!=='string'||!data.userId)return {available:false,error:'请先在桌面登录 ChatGPT',code:'DOTS_AUTH_UNAVAILABLE'};
    return {available:true,identity:{accountId:data.accountId,userId:data.userId}};

}`;

export const dotsRequestScript = String.raw`async ({request,contract,limit,identity,timeoutMs})=>{
   const bridge=window.electronBridge;
   const version=bridge?.getSentryInitOptions?.()?.appVersion??bridge?.getAppVersion?.();
   contract=[contract,...(contract.compatibleContracts??[])].find(candidate=>candidate.version===version);
   if(!contract)throw new Error('此桌面版本尚未验证 Dots 通道（'+(version??'未知')+'）');
   const module=await import(new URL(contract.module,location.href).href);
   const services=module[contract.servicesExport],http=services?.httpFetch;
   const sameAccount=async()=>{const state=await services.accessInputs.readAccountInfo(true);return state?.status==='ready'&&state.data?.accountId===identity.accountId&&state.data?.userId===identity.userId;};
   const accountChanged={status:409,body:null,accountChanged:true};
   if(!http)throw new Error('Dots AppHost service unavailable');
   const id=crypto.randomUUID();
   const nativeHeaders=module[contract.apiExport]?.getRequestTarget?.(request.path)?.headers??{};
   const headers={...nativeHeaders,
    'Content-Type':'application/json','X-OpenAI-Attach-Auth':'1',
    'ChatGPT-Account-Id':identity.accountId,'X-OpenAI-Expected-Account-Id':identity.accountId,
    'X-OpenAI-Attach-Desktop-Surface':'1','X-OpenAI-Attach-Integrity-State':'1',
    'x-openai-web-frontend':'codex_webview','x-openai-codex-window-type':'electron',
   };
   if(request.method==='POST')headers['X-OpenAI-Attach-DeviceCheck-Token']='1';
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
      const status=result?.responseStatus;
      if(Number.isInteger(status)&&status>=400&&status<500&&status!==408&&status!==499)return await sameAccount()?{status,body:{error:'桌面拒绝了 Dots 请求，请检查登录、账户权限或设备验证'}}:accountChanged;
      throw new Error('Dots HTTP transport failed');
     }
     const response=result.response,reader=response.body?.getReader();let size=0,text='';const decoder=new TextDecoder();
     if(reader){try{for(;;){const {done,value}=await reader.read();if(finished)throw new Error('Dots request no longer active');if(done)break;size+=value.byteLength;if(size>limit)throw new Error('Dots response exceeds size limit');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
     let body=null;if(text){try{body=JSON.parse(text);}catch{throw new Error('Dots returned invalid JSON');}}
     if(!await sameAccount())return accountChanged;
     return {status:response.status,body};
    })();
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Dots request timed out')),timeoutMs);});
    return await Promise.race([operation,deadline]);
   }finally{
    finished=true;clearTimeout(timer);void http.cancel(id).catch(()=>{});
    result?.[Symbol.dispose]?.();pending?.[Symbol.dispose]?.();
   }

}`;
