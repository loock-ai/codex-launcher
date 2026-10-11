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
 const services=`const services={accessInputs:{readAccountInfo:async()=>({status:'ready',data:{accountId:'test-account',userId:'test-user'}})},httpFetch:{fetch:async(id,request)=>({response:new Response(JSON.stringify({path:request.url,nativeHeader:request.headers['X-Test-Native']}))}),cancel:async()=>{}}};const api={getRequestTarget:()=>({headers:{'X-Test-Native':'present'}})};`;
 await writeFile(join(root,'assets/app-shared-6c00c2afcf84.js'),services+'export {services as aj,api as rSt};');
 await writeFile(join(root,'assets/app-shared-8bd9d0399038.js'),services+'export {services as fN,api as $wt};');
});
afterAll(async()=>{await rm(root,{recursive:true,force:true});});

async function run(script:string,version:string,args:Record<string,unknown>={}){
 const location={href:pathToFileURL(join(root,'index.html')).href};
 const source=`const window={electronBridge:{getSentryInitOptions:()=>({appVersion:${JSON.stringify(version)}})}};const location=${JSON.stringify(location)};console.log(JSON.stringify(await (${script})(${JSON.stringify({contract:DOTS_DESKTOP_CONTRACT,timeoutMs:1000,...args})})));`;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',source]);
 return JSON.parse(stdout);
}

it.each(['26.1002.52244','26.1007.30912'])('%s 可以检查身份并通过匹配的宿主服务读取 Dots',async version=>{
 await expect(run(dotsStatusScript,version)).resolves.toMatchObject({available:true,identity:{accountId:'test-account',userId:'test-user'}});
 await expect(run(dotsRequestScript,version,{request:{method:'GET',path:'/tbo/primary'},limit:1024,identity:{accountId:'test-account',userId:'test-user'}})).resolves.toEqual({status:200,body:{path:'/tbo/primary',nativeHeader:'present'}});
});

it('未知桌面版本在导入模块和发出请求前被拒绝',async()=>{
 await expect(run(dotsStatusScript,'99.0.0')).resolves.toMatchObject({available:false,error:expect.stringContaining('99.0.0')});
 await expect(run(dotsRequestScript,'99.0.0',{request:{method:'GET',path:'/tbo/primary'},limit:1024,identity:{accountId:'test-account',userId:'test-user'}})).rejects.toThrow('尚未验证');
});
