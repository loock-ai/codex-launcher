// @vitest-environment node
import {it,expect} from 'vitest';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {PluginRepositories} from '../../server/launcher/plugin-repositories.js';
import {validatePluginCatalog} from '../../server/launcher/plugin-catalog.js';
const catalog=(repository:string,id='demo')=>({schemaVersion:1,repository,plugins:[{id,name:'示例',description:'描述',version:'1.0.0',git:{url:repository+'.git',path:'plugins/'+id,ref:'v1.0.0',commit:'a'.repeat(40)},compatibility:{launcherApiVersion:'1',node:'>=20'},release:{url:repository+'/releases/download/v1.0.0/demo.zip',sha256:'b'.repeat(64)}}]});
it('官方仓库仅首次默认配置，可编辑、禁用、删除且重启不恢复',async()=>{
 const root=await mkdtemp(join(tmpdir(),'plugin-repositories-'));try{
 const store=new PluginRepositories(root,async s=>catalog(s.repository));const initial=await store.list();expect(initial).toHaveLength(1);expect(initial[0].repository).toContain('loock-ai/codex-launcher-plugins');
 await store.update(initial[0].id,{repository:initial[0].repository,branch:'stable'});await store.setEnabled(initial[0].id,false);expect((await store.list())[0]).toMatchObject({branch:'stable',enabled:false});await store.remove(initial[0].id);expect(await new PluginRepositories(root,async s=>catalog(s.repository)).list()).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true})}
});
it('添加其他仓库、拒绝重复或伪造目录，一处失效不影响其他仓库',async()=>{
 const root=await mkdtemp(join(tmpdir(),'plugin-sources-'));try{
 let failed=false;const store=new PluginRepositories(root,async s=>{if(failed&&s.repository.endsWith('/other/plugins'))throw Error('offline');return catalog(s.repository)});
 await store.add({repository:'other/plugins',branch:'main'});await expect(store.add({repository:'https://github.com/OTHER/plugins.git',branch:'main'})).rejects.toThrow('已配置');await expect(store.add({repository:'http://127.0.0.1/evil',branch:'main'})).rejects.toThrow();failed=true;const result=await store.catalogs();expect(result.catalogs).toHaveLength(1);expect(result.errors).toHaveLength(1);
 expect(validatePluginCatalog(catalog('https://github.com/other/plugins'),'https://github.com/other/plugins').plugins).toHaveLength(1);
 expect(()=>validatePluginCatalog(catalog('https://github.com/evil/plugins'),'https://github.com/other/plugins')).toThrow();
 }finally{await rm(root,{recursive:true,force:true})}
});
it('多仓库同ID需显式选择来源，禁用来源不卸载插件也不改来源绑定',async()=>{
 const {LauncherController}=await import('../../server/launcher/controller.js');const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');const {createRequire}=await import('node:module');const yazl=createRequire(import.meta.url)('yazl');
 const root=await mkdtemp(join(tmpdir(),'plugin-repo-controller-'));let controller:InstanceType<typeof LauncherController>|undefined;try{
 const zip=new yazl.ZipFile();zip.addBuffer(Buffer.from(JSON.stringify({id:'demo',version:'1.0.0',launcherApiVersion:'1',entrypoints:{main:'main.cjs'}})),'manifest.json');zip.addBuffer(Buffer.from('exports.activate=async()=>({})'),'main.cjs');const chunks:Buffer[]=[];const archive=new Promise<Buffer>((ok,no)=>{zip.outputStream.on('data',(b:Buffer)=>chunks.push(b));zip.outputStream.on('end',()=>ok(Buffer.concat(chunks)));zip.outputStream.on('error',no)});zip.end();const bytes=await archive;
 const sources=new PluginRepositories(root,async s=>{const c=catalog(s.repository);c.plugins[0].release.sha256=createHash('sha256').update(bytes).digest('hex');return c});const added=await sources.add({repository:'other/plugins'});
 controller=new LauncherController(join(root,'config.json'),root,{pluginUpdates:{repositories:sources,download:async()=>bytes}});await controller.initialize();await expect(controller.updatePlugin('demo')).rejects.toThrow('多个仓库');await controller.updatePlugin('demo',{repository:'other/plugins'});
 expect((await controller.checkPluginUpdates()).find(p=>p.sourceRepository?.includes('loock-ai'))?.blockedReason).toContain('其他仓库');const other=added.find(s=>s.repository.endsWith('/other/plugins'))!;await controller.setPluginRepositoryEnabled(other.id,false);await expect(controller.updatePlugin('demo')).rejects.toThrow('禁用');expect(JSON.parse(await readFile(join(root,'plugins/demo/manifest.json'),'utf8')).id).toBe('demo');
 }finally{await controller?.stop();await rm(root,{recursive:true,force:true})}
});
