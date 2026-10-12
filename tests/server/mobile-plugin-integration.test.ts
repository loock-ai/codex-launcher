// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,cp,symlink,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {LauncherController} from '../../server/launcher/controller.js';
it('独立Mobile worker拥有HTTP网关，停止与断线重连不影响时间插件租约',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mobile-bundle-integration-')),pkg=join(root,'package'),data=join(root,'data');const mobile=join(pkg,'plugins/mobile');await mkdir(mobile,{recursive:true});
 await cp(resolve('plugins/mobile/manifest.json'),join(mobile,'manifest.json'));await cp(resolve('plugins/mobile/ui'),join(mobile,'ui'),{recursive:true});await cp(resolve('plugins/desktop-thread-time'),join(pkg,'plugins/desktop-thread-time'),{recursive:true});
 await build({entryPoints:[resolve('plugins/mobile/main.ts')],outfile:join(mobile,'main.cjs'),bundle:true,platform:'node',format:'cjs',target:'node20',packages:'external'});await symlink(resolve('node_modules'),join(pkg,'node_modules'),'dir');await mkdir(join(mobile,'web'));await writeFile(join(mobile,'web/index.html'),'<main>Mobile 插件专属静态资源</main>');
 const port=await new Promise<number>(done=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=(s.address() as any).port;s.close(()=>done(p));});});
 await mkdir(join(data,'plugin-data/mobile'),{recursive:true});await writeFile(join(data,'plugin-data/mobile/config.json'),JSON.stringify({mode:'cdp',gatewayPort:port,appServerPort:port===65535?port-1:port+1,host:'127.0.0.1',token:'integration-token-0123456789',upstreamUrl:'ws://127.0.0.1:18765'}));
 let applied=0,disposed=0,channelCount=0,connected=true,listener=(event:any)=>{};
 const controller=new LauncherController(join(data,'config.json'),pkg,{desktop:{ensure:async()=>{},createChannel:()=>{channelCount++;connected=true;return {connect:async()=>{},close:async()=>{},status:()=>({connected,capabilities:{}}),subscribe:(fn:(event:any)=>void)=>{listener=fn;return()=>{};},hosts:async()=>[{hostId:'local'}],pendingApprovals:()=>[],request:async()=>({data:[],nextCursor:null}),respond:async()=>{},setUserQuestionTargets:()=>{},refreshUserQuestions:async()=>{}} as any;},pluginTransport:()=>({apply:async()=>{applied++;},dispose:async()=>{disposed++;},close:async()=>{}})}});
 try{
  await controller.initialize();await controller.start();expect(controller.listPlugins().plugins.filter(p=>p.state==='running').map(p=>p.id).sort()).toEqual(['desktop-thread-time','mobile']);expect(controller.status().desktop.consumers).toBe(2);expect(applied).toBe(1);
  expect(await(await fetch(`http://127.0.0.1:${port}/`)).text()).toContain('Mobile 插件专属静态资源');
  connected=false;listener({method:'desktop/disconnected',params:{reason:'受控断线'}});await expect.poll(()=>controller.listPlugins().plugins.find(p=>p.id==='mobile')?.state).toBe('waiting');await controller.connectDesktop();expect(channelCount).toBe(2);expect(controller.status().desktop.consumers).toBe(2);expect(controller.listPlugins().plugins.find(p=>p.id==='mobile')?.state).toBe('running');
  await controller.stopPlugin('mobile');expect(controller.listPlugins().plugins.find(p=>p.id==='desktop-thread-time')?.state).toBe('running');expect(controller.status().desktop.consumers).toBe(1);expect(disposed).toBe(0);await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
 }finally{await controller.stop();await rm(root,{recursive:true,force:true});}
 expect(disposed).toBe(1);
},15000);
