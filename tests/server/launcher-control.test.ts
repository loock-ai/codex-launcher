// @vitest-environment node
import {it,expect} from 'vitest';
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
