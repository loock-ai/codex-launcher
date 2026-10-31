// @vitest-environment node
import {afterAll,beforeAll,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DOTS_DESKTOP_CONTRACT} from '../../server/dots/desktop-transport.js';
import {dotsStatusScript,dotsRequestScript} from '../../server/dots/desktop-script.js';

let root:string;
beforeAll(async()=>{
 root=await mkdtemp(join(tmpdir(),'dots-contract-test-'));
 await mkdir(join(root,'assets'));
 const services=`const services={accessInputs:{readAccountInfo:async()=>({status:'ready',data:{accountId:'test-account',userId:'test-user'}})},httpFetch:{fetch:async(id,request)=>request.url.endsWith('/voice/calls')&&(request.headers['X-OpenAI-Attach-DeviceCheck-Token']==='1'||request.url.includes('/refused/'))?({status:400,responseStatus:null,error:'Refusing to attach DeviceCheck token to unexpected URL'}):({response:request.url.endsWith('/voice/calls')?new Response('v=0\\r\\nanswer',{status:201,headers:{location:'/tbo/dot/voice/calls/rtc_test','OpenAI-Root-Thread-ID':'thread-test','Set-Cookie':'must-not-return'}}):new Response(JSON.stringify({path:request.url,nativeHeader:request.headers['X-Test-Native']}))}),cancel:async()=>{}}};const api={getRequestTarget:()=>({headers:{'X-Test-Native':'present'}})};`;
 await writeFile(join(root,'assets/app-shared-6c00c2afcf84.js'),services+'export {services as aj,api as rSt};');
 await writeFile(join(root,'assets/app-shared-8bd9d0399038.js'),services+'export {services as fN,api as $wt};');
 await writeFile(join(root,'assets/app-shared-current.js'),services+'export {services as changedServices};');
 await writeFile(join(root,'assets/app-initial-current.js'),`const api={getRequestTarget:path=>({url:path,headers:{originator:'Codex Desktop','x-openai-web-frontend':'codex_webview','X-Test-Native':'present'}})};export {api as changedApi};`);
 await writeFile(join(root,'assets/app-shared-7815d5a1a42a.js'),services+'export {services as currentServices};');
 await writeFile(join(root,'assets/app-initial-60f141238751.js'),`const api={getRequestTarget:path=>({url:path,headers:{originator:'Codex Desktop','x-openai-web-frontend':'codex_webview','X-Test-Native':'present'}})};export {api as _lr};`);
 await writeFile(join(root,'assets/app-initial-generic.js'),`export const generic={getRequestTarget:path=>({url:path,headers:{}})};`);
 await writeFile(join(root,'assets/app-shared-ambiguous.js'),services+'export {services as first};export const second={...services};');
 await writeFile(join(root,'assets/app-initial-ambiguous.js'),`const api={getRequestTarget:path=>({url:path,headers:{originator:'Codex Desktop','x-openai-web-frontend':'codex_webview'}})};export {api};export const second={...api};`);
});
it('26.1027 在资源计时记录缺失时使用已核对的分离API模块',async()=>{
 await expect(run(dotsStatusScript,'26.1027.30824')).resolves.toMatchObject({available:true});
 await expect(run(dotsRequestScript,'26.1027.30824',{request:{method:'GET',path:'/tbo/primary'},limit:1024,identity:{accountId:'test-account',userId:'test-user'}})).resolves.toMatchObject({status:200,body:{path:'/tbo/primary',nativeHeader:'present'}});
});
it('语音创建保留原始 SDP 和指定响应头，不泄漏其他响应头',async()=>{
 await expect(run(dotsRequestScript,'26.1007.30912',{request:{method:'POST',path:'/tbo/dot/voice/calls',body:{sdp:'v=0\r\noffer'}},limit:1024,identity:{accountId:'test-account',userId:'test-user'}})).resolves.toEqual({status:201,body:'v=0\r\nanswer',headers:{location:'/tbo/dot/voice/calls/rtc_test','openai-root-thread-id':'thread-test'}});
});
afterAll(async()=>{await rm(root,{recursive:true,force:true});});

async function run(script:string,version:string,args:Record<string,unknown>={},resources:string[]=[]){
 const location={href:pathToFileURL(join(root,'index.html')).href};
 const resourceUrls=resources.map(file=>pathToFileURL(join(root,'assets',file)).href);
 const source=`const performance={getEntriesByType:()=>${JSON.stringify(resourceUrls)}.map(name=>({name}))};const document={querySelectorAll:()=>[]};const window={electronBridge:{getSentryInitOptions:()=>({appVersion:${JSON.stringify(version)}})}};const location=${JSON.stringify(location)};console.log(JSON.stringify(await (${script})(${JSON.stringify({contract:DOTS_DESKTOP_CONTRACT,timeoutMs:1000,...args})})));`;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',source]);
 return JSON.parse(stdout);
}

it.each(['26.1002.52244','26.1007.30912'])('%s 可以检查身份并通过匹配的宿主服务读取 Dots',async version=>{
 await expect(run(dotsStatusScript,version)).resolves.toMatchObject({available:true,identity:{accountId:'test-account',userId:'test-user'}});
 await expect(run(dotsRequestScript,version,{request:{method:'GET',path:'/tbo/primary'},limit:1024,identity:{accountId:'test-account',userId:'test-user'}})).resolves.toEqual({status:200,body:{path:'/tbo/primary',nativeHeader:'present'}});
});

it.each(['26.1021.31345','99.0.0'])('%s 根据已加载模块能力发现分离的服务和原生API',async version=>{
 const resources=['app-shared-current.js','app-initial-current.js'];
 await expect(run(dotsStatusScript,version,{},resources)).resolves.toMatchObject({available:true});
 await expect(run(dotsRequestScript,version,{request:{method:'GET',path:'/tbo/primary'},limit:1024,identity:{accountId:'test-account',userId:'test-user'}},resources)).resolves.toEqual({status:200,body:{path:'/tbo/primary',nativeHeader:'present'}});
});
it('没有可识别的服务时返回能力缺失而非版本限制',async()=>{
 await expect(run(dotsStatusScript,'99.0.0')).resolves.toMatchObject({available:false,error:expect.stringContaining('HTTP 服务')});
});
it('不能将通用API当成桌面原生Dots API',async()=>{
 await expect(run(dotsStatusScript,'99.0.0',{},['app-shared-current.js','app-initial-generic.js'])).resolves.toMatchObject({available:false,error:expect.stringContaining('原生 Dots API')});
});
it.each([['app-shared-ambiguous.js','app-initial-current.js'],['app-shared-current.js','app-initial-ambiguous.js']])('服务或API存在歧义时不发送请求：%s',async(...resources)=>{
 await expect(run(dotsStatusScript,'99.0.0',{},resources)).resolves.toMatchObject({available:false,error:expect.stringContaining('唯一')});
 await expect(run(dotsRequestScript,'99.0.0',{request:{method:'POST',path:'/messaging/rooms/room/messages'},identity:{accountId:'test-account',userId:'test-user'}},resources)).rejects.toThrow('唯一');
});

it('原生请求发送前明确拒绝设备校验标记时返回拒绝状态，不误报投递未知',async()=>{
 await expect(run(dotsRequestScript,'26.1007.30912',{request:{method:'POST',path:'/tbo/refused/voice/calls',body:{sdp:'v=0\r\noffer'}},limit:1024,identity:{accountId:'test-account',userId:'test-user'}})).resolves.toMatchObject({status:400});
});
