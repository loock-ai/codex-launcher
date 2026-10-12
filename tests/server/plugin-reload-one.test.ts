// @vitest-environment node
import {it,expect} from 'vitest';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {PluginManager} from '../../server/launcher/plugin-runtime.js';
it('重新加载一个注入插件，不停止另一个运行中的插件',async()=>{
 const root=await mkdtemp(join(tmpdir(),'plugin-reload-one-'));const calls:any[]=[];
 for(const id of ['one','two']){await mkdir(join(root,'plugins',id),{recursive:true});await writeFile(join(root,'plugins',id,'manifest.json'),JSON.stringify({id,version:'1.0.0',entry:'inject.js',defaultEnabled:true}));await writeFile(join(root,'plugins',id,'inject.js'),'context.onDispose(()=>{});');}
 const manager=new PluginManager(join(root,'config.json'),root,{call:async(id,method)=>{calls.push([id,method]);},release:async id=>{calls.push([id,'release']);}});
 try{await manager.initialize();await manager.start('one');await manager.start('two');calls.length=0;await manager.reloadPlugin('one');expect(manager.list().plugins.find(p=>p.id==='two')?.state).toBe('running');expect(calls.filter(x=>x[0]==='two')).toEqual([]);}finally{await manager.shutdown();await rm(root,{recursive:true,force:true});}
});
