// @vitest-environment node
import {it,expect} from 'vitest';import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {PluginInstaller,extractPluginZip} from '../../server/launcher/plugin-installer.js';
import {validatePluginCatalog} from '../../server/launcher/plugin-catalog.js';
const yazl=createRequire(import.meta.url)('yazl');
async function zip(files:Record<string,string>){const z=new yazl.ZipFile();for(const [name,text]of Object.entries(files))z.addBuffer(Buffer.from(text),name);const chunks:Buffer[]=[];const result=new Promise<Buffer>((ok,no)=>{z.outputStream.on('data',(b:Buffer)=>chunks.push(b));z.outputStream.on('end',()=>ok(Buffer.concat(chunks)));z.outputStream.on('error',no)});z.end();return result;}
const entry=(bytes:Buffer)=>({id:'demo',name:'示例',description:'插件',version:'1.0.1',git:{url:'https://github.com/loock-ai/codex-launcher-plugins.git',path:'plugins/demo',ref:'demo-v1.0.1',commit:'a'.repeat(40)},compatibility:{launcherApiVersion:'1',node:'>=20'},release:{url:'https://github.com/loock-ai/codex-launcher-plugins/releases/download/demo-v1.0.1/demo-1.0.1.zip',sha256:createHash('sha256').update(bytes).digest('hex')}});
const manifest={id:'demo',version:'1.0.1',launcherApiVersion:'1',entrypoints:{main:'main.cjs'}};
it('更新只切换代码，保留配置、策略；失败回滚旧代码',async()=>{
 const root=await mkdtemp(join(tmpdir(),'plugin-install-'));try{
 await mkdir(join(root,'plugins/demo'),{recursive:true});await writeFile(join(root,'plugins/demo/main.cjs'),'old');await writeFile(join(root,'plugins/demo/manifest.json'),JSON.stringify({...manifest,version:'1.0.0'}));await mkdir(join(root,'plugin-data/demo'),{recursive:true});await writeFile(join(root,'plugin-data/demo/config.json'),'secret-config');await writeFile(join(root,'plugins.json'),'saved-policy');
 const bytes=await zip({'manifest.json':JSON.stringify(manifest),'main.cjs':'new'});let fail=true;
 const lifecycle={stop:async()=>{},reload:async()=>{},restore:async()=>{if(fail)throw Error('load failed')}};
 const installer=new PluginInstaller(root,lifecycle,async()=>bytes);
 await expect(installer.install(entry(bytes))).rejects.toThrow('本地');
 await expect(installer.install(entry(bytes),{allowLocalChanges:true})).rejects.toThrow('load failed');expect(await readFile(join(root,'plugins/demo/main.cjs'),'utf8')).toBe('old');
 fail=false;await installer.install(entry(bytes),{allowLocalChanges:true});expect(await readFile(join(root,'plugins/demo/main.cjs'),'utf8')).toBe('new');expect(await readFile(join(root,'plugin-data/demo/config.json'),'utf8')).toBe('secret-config');expect(await readFile(join(root,'plugins.json'),'utf8')).toBe('saved-policy');
 const bad={...entry(bytes),release:{...entry(bytes).release,sha256:'b'.repeat(64)}};await expect(installer.install(bad)).rejects.toThrow('哈希');
 }finally{await rm(root,{recursive:true,force:true});}
});
it('非法目录、ID、版本、API与ZIP路径不能安装',async()=>{
 const catalog={schemaVersion:1,repository:'https://github.com/loock-ai/codex-launcher-plugins',plugins:[entry(Buffer.from('a'))]};expect(validatePluginCatalog(catalog).plugins).toHaveLength(1);expect(()=>validatePluginCatalog({...catalog,plugins:[catalog.plugins[0],catalog.plugins[0]]})).toThrow();
 const root=await mkdtemp(join(tmpdir(),'plugin-zip-'));try{
 const bytes=await zip({'manifest.json':JSON.stringify({...manifest,id:'other'}),'main.cjs':'new'});const installer=new PluginInstaller(root,{stop:async()=>{},reload:async()=>{},restore:async()=>{}},async()=>bytes);
 await expect(installer.install(entry(bytes))).rejects.toThrow('manifest');
 const b=await zip({'manifest.json':JSON.stringify(manifest),'main.cjs':'new'});await expect(new PluginInstaller(root,{stop:async()=>{},reload:async()=>{},restore:async()=>{}},async()=>b).install({...entry(b),compatibility:{launcherApiVersion:'2',node:'>=20'}})).rejects.toThrow('API');
 // Mutate same-length ZIP filename so the extractor sees actual malicious archive bytes.
 const x=await zip({'xxx/foo':'x'});const malicious=Buffer.from(x);let at=0;while((at=malicious.indexOf('xxx/foo',at))>=0){malicious.write('../evil',at);at+=7;}
 await expect(extractPluginZip(malicious,join(root,'unsafe'))).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});
it('ZIP符号链接、重复名称和伪造巨大解压大小被拒绝',async()=>{
 const root=await mkdtemp(join(tmpdir(),'plugin-unsafe-'));try{
 const make=async(mode?:number)=>{const z=new yazl.ZipFile();z.addBuffer(Buffer.from('x'),'link',mode?{mode}:{});const chunks:Buffer[]=[];const result=new Promise<Buffer>((ok,no)=>{z.outputStream.on('data',(b:Buffer)=>chunks.push(b));z.outputStream.on('end',()=>ok(Buffer.concat(chunks)));z.outputStream.on('error',no)});z.end();return result};
 await expect(extractPluginZip(await make(0o120777),join(root,'link'))).rejects.toThrow('符号链接');
 const huge=await make();const cde=huge.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));huge.writeUInt32LE(301*1024*1024,cde+24);await expect(extractPluginZip(huge,join(root,'huge'))).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true})}
});
it('同一宿主进程真实重载新版后台，并保留另一个插件和独立配置',async()=>{
 const {LauncherController}=await import('../../server/launcher/controller.js');const {PluginCatalog}=await import('../../server/launcher/plugin-catalog.js');
 const root=await mkdtemp(join(tmpdir(),'plugin-real-update-'));let controller:InstanceType<typeof LauncherController>|undefined;
 try{
 const code=(version:string)=>`exports.activate=async ctx=>{ctx.actions.register('version',()=>${JSON.stringify(version)});return {start(){},stop(){},deactivate(){}}};`;
 for(const id of ['demo','other']){await mkdir(join(root,'plugins',id),{recursive:true});await writeFile(join(root,'plugins',id,'manifest.json'),JSON.stringify({id,version:'1.0.0',launcherApiVersion:'1',defaultEnabled:true,entrypoints:{main:'main.cjs'}}));await writeFile(join(root,'plugins',id,'main.cjs'),code('old'));}
 await mkdir(join(root,'plugin-data/demo'),{recursive:true});await writeFile(join(root,'plugin-data/demo/config.json'),'{"setting":"kept"}');
 const bytes=await zip({'manifest.json':JSON.stringify({...manifest,defaultEnabled:true}),'main.cjs':code('new')});const p=entry(bytes);
 controller=new LauncherController(join(root,'config.json'),root,{pluginUpdates:{catalog:new PluginCatalog(async()=>({schemaVersion:1,repository:'https://github.com/loock-ai/codex-launcher-plugins',plugins:[p]})),download:async()=>bytes}});
 await controller.initialize();await controller.startPlugin('demo');await controller.startPlugin('other');
 const updates=await controller.checkPluginUpdates();expect(updates[0]).toMatchObject({installedVersion:'1.0.0',version:'1.0.1',locallyModified:true,updateAvailable:true});
 await controller.updatePlugin('demo',{allowLocalChanges:true});expect(await controller.invokePlugin('demo','version',{})).toBe('new');expect(await controller.invokePlugin('other','version',{})).toBe('old');expect(controller.listPlugins().plugins.find(x=>x.id==='other')?.state).toBe('running');expect(await readFile(join(root,'plugin-data/demo/config.json'),'utf8')).toBe('{"setting":"kept"}');
 }finally{await controller?.stop();await rm(root,{recursive:true,force:true})}
});
it('目录名与ID不一致或被其他ID占用时拒绝更新，不生成重复插件',async()=>{
 const root=await mkdtemp(join(tmpdir(),'plugin-alias-'));try{
 await mkdir(join(root,'plugins/custom-name'),{recursive:true});await writeFile(join(root,'plugins/custom-name/manifest.json'),JSON.stringify({...manifest,version:'1.0.0'}));await writeFile(join(root,'plugins/custom-name/main.cjs'),'user-code');
 const bytes=await zip({'manifest.json':JSON.stringify(manifest),'main.cjs':'new'});const installer=new PluginInstaller(root,{stop:async()=>{},reload:async()=>{},restore:async()=>{}},async()=>bytes);
 await expect(installer.install(entry(bytes),{allowLocalChanges:true})).rejects.toThrow('目录');expect(await readFile(join(root,'plugins/custom-name/main.cjs'),'utf8')).toBe('user-code');
 await rm(join(root,'plugins/custom-name'),{recursive:true});await mkdir(join(root,'plugins/demo'));await writeFile(join(root,'plugins/demo/manifest.json'),JSON.stringify({...manifest,id:'other'}));await writeFile(join(root,'plugins/demo/main.cjs'),'other-code');
 await expect(installer.install(entry(bytes),{allowLocalChanges:true})).rejects.toThrow('目录');expect(await readFile(join(root,'plugins/demo/main.cjs'),'utf8')).toBe('other-code');
 }finally{await rm(root,{recursive:true,force:true})}
});
