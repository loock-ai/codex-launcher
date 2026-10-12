// @vitest-environment node
import {it,expect} from 'vitest';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {PluginManager} from '../../server/launcher/plugin-runtime.js';
it('重新加载一个注入插件，不停止另一个运行中的插件',async()=>{
 const root=await mkdtemp(join(tmpdir(),'plugin-reload-one-'));const calls:any[]=[];
 for(const id of ['one','two']){await mkdir(join(root,'plugins',id),{recursive:true});await writeFile(join(root,'plugins',id,'manifest.json'),JSON.stringify({id,version:'1.0.0',entry:'inject.js',defaultEnabled:true}));await writeFile(join(root,'plugins',id,'inject.js'),'context.onDispose(()=>{});');}
 const manager=new PluginManager(join(root,'config.json'),root,{call:async(id,method)=>{calls.push([id,method]);},release:async id=>{calls.push([id,'release']);}});
 try{await manager.initialize();await manager.start('one');await manager.start('two');calls.length=0;await manager.reloadPlugin('one');expect(manager.list().plugins.find(p=>p.id==='two')?.state).toBe('running');expect(calls.filter(x=>x[0]==='two')).toEqual([]);}finally{await manager.shutdown();await rm(root,{recursive:true,force:true});}
});
it('旧后台延迟宿主请求清理完成前，不加载新版且不释放新版资源',async()=>{
 const root=await mkdtemp(join(tmpdir(),'plugin-drain-'));const dir=join(root,'plugins/demo');await mkdir(dir,{recursive:true});await writeFile(join(dir,'manifest.json'),JSON.stringify({id:'demo',version:'1.0.0',defaultEnabled:true,entrypoints:{main:'main.cjs'}}));
 await writeFile(join(dir,'main.cjs'),`exports.activate=async ctx=>({async start(){await ctx.host.call('acquire');void ctx.host.call('slow');},stop(){},deactivate(){}})`);
 let done!:(value:unknown)=>void,seen!:()=>void;let active=false;const started=new Promise<void>(r=>seen=r);
 const manager=new PluginManager(join(root,'config.json'),root,{call:async(_id,method)=>{if(method==='acquire'){active=true;return {}}if(method==='slow'){seen();return new Promise(r=>done=r)}return{}},release:async()=>{active=false;}});
 let reload:Promise<unknown>|undefined;
 try{await manager.initialize();await manager.start('demo');await started;await writeFile(join(dir,'main.cjs'),`exports.activate=async ctx=>({start(){return ctx.host.call('acquire')},stop(){},deactivate(){}})`);
 reload=manager.reloadPlugin('demo');const early=await Promise.race([reload.then(()=>true),new Promise<boolean>(r=>setTimeout(()=>r(false),500))]);expect(early).toBe(false);
 done({});await reload;await manager.start('demo');expect(active).toBe(true);
 }finally{done?.({});await reload?.catch(()=>{});await manager.shutdown();await rm(root,{recursive:true,force:true});}
});
it('删除单个插件备份代码并保留独立配置，不停止其他插件',async()=>{
 const {readFile}=await import('node:fs/promises');const root=await mkdtemp(join(tmpdir(),'plugin-delete-'));for(const id of ['one','two']){await mkdir(join(root,'plugins',id),{recursive:true});await writeFile(join(root,'plugins',id,'manifest.json'),JSON.stringify({id,version:'1.0.0',entry:'inject.js',defaultEnabled:true}));await writeFile(join(root,'plugins',id,'inject.js'),'context.onDispose(()=>{});');}await mkdir(join(root,'plugin-data/one'),{recursive:true});await writeFile(join(root,'plugin-data/one/config.json'),'saved-config');
 const manager=new PluginManager(join(root,'config.json'),root,{call:async()=>{},release:async()=>{}});
 try{await manager.initialize();await manager.start('one');await manager.start('two');await manager.uninstall('one');expect(manager.list().plugins.map(p=>p.id)).toEqual(['two']);expect(manager.list().plugins[0].state).toBe('running');expect(await readFile(join(root,'plugin-data/one/config.json'),'utf8')).toBe('saved-config');expect(JSON.parse(await readFile(join(root,'plugins.json'),'utf8')).enabled).toEqual(['two']);}finally{await manager.shutdown();await rm(root,{recursive:true,force:true})}
});
it('删除内置插件后重启不重新复制，失败时恢复代码与开关',async()=>{
 const {cp,readFile}=await import('node:fs/promises');const root=await mkdtemp(join(tmpdir(),'plugin-delete-template-')),packageRoot=await mkdtemp(join(tmpdir(),'plugin-delete-package-'));await mkdir(join(packageRoot,'plugins/demo'),{recursive:true});await writeFile(join(packageRoot,'plugins/demo/manifest.json'),JSON.stringify({id:'demo',version:'1.0.0',entry:'inject.js',defaultEnabled:true}));await writeFile(join(packageRoot,'plugins/demo/inject.js'),'context.onDispose(()=>{});');const bridge={call:async()=>{},release:async()=>{}};const manager=new PluginManager(join(root,'config.json'),packageRoot,bridge);
 try{await manager.initialize();await expect(manager.uninstall('demo',async()=>{throw Error('metadata failed')})).rejects.toThrow('metadata failed');expect(manager.list().plugins[0].enabled).toBe(true);expect(await readFile(join(root,'plugins/demo/inject.js'),'utf8')).toContain('onDispose');await manager.uninstall('demo');const restarted=new PluginManager(join(root,'config.json'),packageRoot,bridge);await restarted.initialize();expect(restarted.list().plugins).toEqual([]);await restarted.shutdown();}finally{await manager.shutdown();await rm(root,{recursive:true,force:true});await rm(packageRoot,{recursive:true,force:true})}
});
it('备份目录异常导致删除失败时恢复原运行状态',async()=>{
 const root=await mkdtemp(join(tmpdir(),'plugin-delete-error-'));await mkdir(join(root,'plugins/demo'),{recursive:true});await writeFile(join(root,'plugins/demo/manifest.json'),JSON.stringify({id:'demo',version:'1.0.0',defaultEnabled:true,entrypoints:{main:'main.cjs'}}));await writeFile(join(root,'plugins/demo/main.cjs'),`exports.activate=async ctx=>{ctx.actions.register('alive',()=>true);return {start(){},stop(){},deactivate(){}}};`);await writeFile(join(root,'plugin-backups'),'not-a-directory');const manager=new PluginManager(join(root,'config.json'),root,{call:async()=>{},release:async()=>{}});
 try{await manager.initialize();await manager.start('demo');await expect(manager.uninstall('demo')).rejects.toThrow();expect(manager.list().plugins[0].state).toBe('running');expect(await manager.invoke('demo','alive',{})).toBe(true);}finally{await manager.shutdown();await rm(root,{recursive:true,force:true})}
});
