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
