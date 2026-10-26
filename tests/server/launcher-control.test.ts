// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,realpath,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LauncherController} from '../../server/launcher/controller.js';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'launcher-generic-'));const plugin=join(root,'plugins','example');await mkdir(join(plugin,'ui'),{recursive:true});
 await writeFile(join(plugin,'manifest.json'),JSON.stringify({manifestVersion:2,id:'example',name:'任意插件',version:'1',defaultEnabled:true,autoStartDefault:true,entrypoints:{main:'main.cjs',ui:'ui/index.html'}}));
 await writeFile(join(plugin,'ui/index.html'),'<main>example</main>');
 await writeFile(join(plugin,'main.cjs'),`exports.activate=async ctx=>{let running=false;ctx.actions.register('state',()=>({running}));ctx.actions.register('open',()=>ctx.host.call('system.openExternal',{url:'https://example.com/'}));return {start:()=>{running=true},stop:()=>{running=false}}};`);
 return {root,plugin};
}
it('没有Mobile也能初始化、自动运行普通插件并按独立UI路径加载',async()=>{
 const {root,plugin}=await fixture();const opened:string[]=[];const controller=new LauncherController(join(root,'config.json'),root,{system:{openExternal:async url=>{opened.push(url)},writeClipboard:()=>{}}});
 try{await controller.initialize();expect(controller.status().desktop.appPath).toBe('/Applications/ChatGPT.app');await controller.start();expect(controller.listPlugins().plugins[0].state).toBe('running');expect(await controller.invokePlugin('example','state',{})).toEqual({running:true});expect(controller.pluginUiUrl('example')).toBe('launcher-plugin://plugin/example/ui/index.html');expect(await controller.resolvePluginUiAsset('example','ui/index.html')).toBe(await realpath(join(plugin,'ui/index.html')));await controller.invokePlugin('example','open',{});expect(opened).toEqual(['https://example.com/']);await controller.stopPlugin('example');expect(await controller.invokePlugin('example','state',{})).toEqual({running:false});await controller.setPluginAutoStart('example',false);await controller.reloadPlugins();expect(controller.listPlugins().plugins[0]).toMatchObject({state:'stopped',autoStart:false});}finally{await controller.stop();await rm(root,{recursive:true,force:true});}
});
it('宿主只保存桌面设置，不返回或写入Mobile字段',async()=>{
 const {root}=await fixture();const controller=new LauncherController(join(root,'config.json'),root);
 try{await controller.initialize();await controller.saveDesktopSettings({appPath:'/Applications/Another.app',cdpPort:9456});expect(controller.status().desktop).toMatchObject({appPath:'/Applications/Another.app',cdpPort:9456});expect(controller.status()).not.toHaveProperty('accessUrl');expect(controller.status()).not.toHaveProperty('config');await expect(controller.invokePlugin('mobile','open-web',{})).rejects.toThrow();}finally{await controller.stop();await rm(root,{recursive:true,force:true});}
});
it('重启桌面前停止已运行插件，随后恢复；停止的插件保持停止',async()=>{
 const {root,plugin}=await fixture(),events=join(root,'events.txt');await writeFile(events,'');
 await writeFile(join(plugin,'main.cjs'),`const fs=require('node:fs');exports.activate=()=>({start(){fs.appendFileSync(${JSON.stringify(events)},'start\\n')},stop(){fs.appendFileSync(${JSON.stringify(events)},'stop\\n')}});`);
 const controller=new LauncherController(join(root,'config.json'),root,{desktop:{restart:async()=>{await writeFile(events,(await readFile(events,'utf8'))+'restart\n');}}});
 try{await controller.initialize();await controller.start();await writeFile(events,'');await controller.restartDesktop();expect(await readFile(events,'utf8')).toBe('stop\nrestart\nstart\n');expect(controller.listPlugins().plugins[0].state).toBe('running');await controller.stopPlugin('example');await writeFile(events,'');await controller.restartDesktop();expect(await readFile(events,'utf8')).toBe('restart\n');expect(controller.listPlugins().plugins[0].state).toBe('stopped');}finally{await controller.stop();await rm(root,{recursive:true,force:true});}
});
it('有效插件服务报错时仍可打开其配置页面',async()=>{
 const {root,plugin}=await fixture();await writeFile(join(plugin,'main.cjs'),`exports.activate=()=>({start(){throw Error('端口占用')}});`);const controller=new LauncherController(join(root,'config.json'),root);
 try{await controller.initialize();await expect(controller.startPlugin('example')).rejects.toThrow('端口占用');expect(controller.pluginUiUrl('example')).toBe('launcher-plugin://plugin/example/ui/index.html');}finally{await controller.stop();await rm(root,{recursive:true,force:true});}
});
it('等待中的桌面插件自动恢复，手动停止后不会被再次拉起',async()=>{
 const {root,plugin}=await fixture();let ready=false;let connects=0;
 await writeFile(join(plugin,'main.cjs'),`exports.activate=ctx=>{let lease;return {async start(){lease=await ctx.host.call('desktop.acquire')},async stop(){if(lease){await ctx.host.call('desktop.release',lease);lease=undefined}}}};`);
 const controller=new LauncherController(join(root,'config.json'),root,{recoveryIntervalMs:30,desktop:{ensure:async()=>{if(!ready)throw Error('starting')},health:async()=>({healthy:ready&&connects>0,activity:'idle',restartable:false}),createChannel:()=>({connect:async()=>{connects++},close:async()=>{},status:()=>({connected:ready}),subscribe:()=>()=>{},setUserQuestionTargets:()=>{},hosts:async()=>[],pendingApprovals:()=>[]}) as any}});
 try{await controller.initialize();await controller.start();expect(controller.listPlugins().plugins[0].state).toBe('waiting');ready=true;
 await new Promise(resolve=>setTimeout(resolve,150));expect(controller.listPlugins().plugins[0].state).toBe('running');
 await controller.stopPlugin('example');const previous=connects;await new Promise(resolve=>setTimeout(resolve,100));expect(connects).toBe(previous);expect(controller.listPlugins().plugins[0].state).toBe('stopped');
 }finally{await controller.stop();await rm(root,{recursive:true,force:true})}
});
it('通道丢失后重建桌面消费者，但不重启桌面进程',async()=>{
 const {root,plugin}=await fixture();let connected=false,connects=0,restarts=0;
 await writeFile(join(plugin,'main.cjs'),`exports.activate=ctx=>{let lease;return {async start(){lease=await ctx.host.call('desktop.acquire')},async stop(){if(lease){await ctx.host.call('desktop.release',lease);lease=undefined}}}};`);
 const controller=new LauncherController(join(root,'config.json'),root,{recoveryIntervalMs:30,desktop:{ensure:async()=>{},restart:async()=>{restarts++},health:async()=>({healthy:connected,activity:'idle',restartable:true}),createChannel:()=>({connect:async()=>{connected=true;connects++},close:async()=>{},status:()=>({connected}),subscribe:()=>()=>{},setUserQuestionTargets:()=>{},hosts:async()=>[],pendingApprovals:()=>[]}) as any}});
 try{await controller.initialize();await controller.start();connected=false;await new Promise(resolve=>setTimeout(resolve,180));expect(connects).toBe(2);expect(restarts).toBe(0);expect(controller.listPlugins().plugins[0].state).toBe('running');}finally{await controller.stop();await rm(root,{recursive:true,force:true})}
});
it('手动停止能取消正在探测的恢复，不在用户停止后重新启动',async()=>{
 const {root,plugin}=await fixture();let probeFinish!:(value:any)=>void;let connects=0;
 await writeFile(join(plugin,'main.cjs'),`exports.activate=ctx=>{let lease;return {async start(){lease=await ctx.host.call('desktop.acquire')},async stop(){if(lease){await ctx.host.call('desktop.release',lease);lease=undefined}}}};`);
 const controller=new LauncherController(join(root,'config.json'),root,{recoveryIntervalMs:30,desktop:{ensure:async()=>{},health:()=>new Promise(resolve=>{probeFinish=resolve}),createChannel:()=>({connect:async()=>{connects++},close:async()=>{},status:()=>({connected:true}),subscribe:()=>()=>{},setUserQuestionTargets:()=>{},hosts:async()=>[],pendingApprovals:()=>[]}) as any}});
 try{await controller.initialize();await controller.start();await new Promise(resolve=>setTimeout(resolve,60));expect(probeFinish).toBeTypeOf('function');const stop=controller.stopPlugin('example');probeFinish({healthy:false,activity:'unknown',restartable:true});await stop;await new Promise(resolve=>setTimeout(resolve,60));expect(connects).toBe(1);expect(controller.listPlugins().plugins[0].state).toBe('stopped');}finally{await controller.stop();await rm(root,{recursive:true,force:true})}
});
it('持续失败时按策略重启桌面并恢复原插件',async()=>{
 const {root,plugin}=await fixture();let now=0,ready=false,restarts=0;
 const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
 await writeFile(join(root,'config.json'),JSON.stringify({schemaVersion:2,desktop:{appPath:'/fixture.app',cdpPort:19340,restartDuringTasks:true}}));
 await writeFile(join(plugin,'main.cjs'),`exports.activate=ctx=>{let lease;return {async start(){lease=await ctx.host.call('desktop.acquire')},async stop(){if(lease){await ctx.host.call('desktop.release',lease);lease=undefined}}}};`);
 const controller=new LauncherController(join(root,'config.json'),root,{recoveryIntervalMs:20,desktop:{ensure:async()=>{if(!ready)throw Error('unavailable')},restart:async()=>{restarts++;ready=true},health:async()=>({healthy:ready,activity:'unknown',restartable:true}),createChannel:()=>({connect:async()=>{},close:async()=>{},status:()=>({connected:true}),subscribe:()=>()=>{},setUserQuestionTargets:()=>{},hosts:async()=>[],pendingApprovals:()=>[]}) as any}});
 try{await controller.initialize();await controller.start();for(const at of [0,3000,9000,20000,41000,72000]){now=at;await new Promise(resolve=>setTimeout(resolve,55));}expect(restarts).toBe(1);expect(controller.listPlugins().plugins[0].state).toBe('running');}finally{clock.mockRestore();await controller.stop();await rm(root,{recursive:true,force:true})}
});
it('手动重启恢复自动恢复阶段已停下的插件',async()=>{
 const {root,plugin}=await fixture();let ready=false,restarts=0;
 await writeFile(join(plugin,'main.cjs'),`exports.activate=ctx=>{let lease;return {async start(){lease=await ctx.host.call('desktop.acquire')},async stop(){if(lease){await ctx.host.call('desktop.release',lease);lease=undefined}}}};`);
 const controller=new LauncherController(join(root,'config.json'),root,{recoveryIntervalMs:20,desktop:{ensure:async()=>{if(!ready)throw Error('unavailable')},restart:async()=>{restarts++;ready=true},health:async()=>({healthy:false,activity:'unknown',restartable:true}),createChannel:()=>({connect:async()=>{},close:async()=>{},status:()=>({connected:true}),subscribe:()=>()=>{},setUserQuestionTargets:()=>{}}) as any}});
 try{await controller.initialize();await controller.start();await new Promise(resolve=>setTimeout(resolve,60));expect(controller.listPlugins().plugins[0].state).toBe('stopped');await controller.restartDesktop();expect(restarts).toBe(1);expect(controller.listPlugins().plugins[0].state).toBe('running');}finally{await controller.stop();await rm(root,{recursive:true,force:true})}
});
it('RPC入口排队前暂停恢复，等待期间不会启动新的恢复尝试',async()=>{
 const {root,plugin}=await fixture();let attempts=0;
 await writeFile(join(plugin,'main.cjs'),`exports.activate=ctx=>({async start(){await ctx.host.call('desktop.acquire')},stop(){}});`);
 const controller=new LauncherController(join(root,'config.json'),root,{recoveryIntervalMs:20,desktop:{ensure:async()=>{attempts++;throw Error('unavailable')},health:async()=>({healthy:false,activity:'unknown',restartable:true})}});
 try{await controller.initialize();const resume=controller.pauseAutomaticRecovery();await controller.start();const before=attempts;await new Promise(resolve=>setTimeout(resolve,80));expect(attempts).toBe(before);await controller.stopPlugin('example');resume();await new Promise(resolve=>setTimeout(resolve,50));expect(attempts).toBe(before);}finally{await controller.stop();await rm(root,{recursive:true,force:true})}
});
it('停止其他插件造成的取消不会丢失当前桌面插件的恢复意图',async()=>{
 const {root,plugin}=await fixture();let ready=false,connected=false,calls=0,offset=0,finish!:()=>void;const realNow=Date.now.bind(Date);const clock=vi.spyOn(Date,'now').mockImplementation(()=>realNow()+offset);
 const other=join(root,'plugins','other');await mkdir(other,{recursive:true});await writeFile(join(other,'manifest.json'),JSON.stringify({manifestVersion:2,id:'other',version:'1',defaultEnabled:true,autoStartDefault:true,entrypoints:{main:'main.cjs'}}));await writeFile(join(other,'main.cjs'),'exports.activate=()=>({start(){},stop(){}})');
 await writeFile(join(plugin,'main.cjs'),`exports.activate=ctx=>{let lease;return {async start(){lease=await ctx.host.call('desktop.acquire')},async stop(){if(lease){await ctx.host.call('desktop.release',lease);lease=undefined}}}};`);
 const controller=new LauncherController(join(root,'config.json'),root,{recoveryIntervalMs:20,desktop:{ensure:async()=>{calls++;if(!ready)throw Error('unavailable');if(calls===3)await new Promise<void>(resolve=>{finish=resolve})},health:async()=>({healthy:connected,activity:'idle',restartable:true}),createChannel:()=>({connect:async()=>{connected=true},close:async()=>{},status:()=>({connected}),subscribe:()=>()=>{},setUserQuestionTargets:()=>{}}) as any}});
 try{await controller.initialize();await controller.start();ready=true;await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));const resume=controller.pauseAutomaticRecovery();const stopping=controller.stopPlugin('other');finish();await stopping;resume();offset+=3000;await vi.waitFor(()=>expect(controller.listPlugins().plugins.find(p=>p.id==='example')?.state).toBe('running'));expect(controller.listPlugins().plugins.find(p=>p.id==='other')?.state).toBe('stopped');}finally{clock.mockRestore();await controller.stop();await rm(root,{recursive:true,force:true})}
});
