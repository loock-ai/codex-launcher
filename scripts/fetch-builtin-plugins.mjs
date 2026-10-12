import {readFile,writeFile,mkdir,rm,cp} from 'node:fs/promises';import {join,resolve,dirname} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
import {extractPluginZip} from '../server/launcher/plugin-installer.ts';
import {downloadPluginBytes,validatePluginCatalog} from '../server/launcher/plugin-catalog.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function fetchBuiltinPlugins(lock,outDir=join(root,'plugins')){
 validatePluginCatalog(lock);for(const p of lock.plugins){
 const cache=join(root,'.cache/plugins',`${p.id}-${p.version}-${p.release.sha256}.zip`);let bytes;try{bytes=await readFile(cache)}catch(e){if(e.code!=='ENOENT')throw e;bytes=await downloadPluginBytes(p.release.url)}
 if(createHash('sha256').update(bytes).digest('hex')!==p.release.sha256)throw Error('内置插件哈希不符');await mkdir(dirname(cache),{recursive:true});await writeFile(cache,bytes);
 const target=join(outDir,p.id);await rm(target,{recursive:true,force:true});await extractPluginZip(bytes,target);
 const manifest=JSON.parse(await readFile(join(target,'manifest.json'),'utf8'));if(manifest.id!==p.id||manifest.version!==p.version)throw Error('内置插件版本不符');
 if(p.id==='mobile'){
 const source=join(target,'source');const names=JSON.parse(await readFile(join(source,'compatibility-files.json'),'utf8'));
 for(const name of names){if(typeof name!=='string'||/^[\/\\]|\\|:/.test(name)||name.split('/').some(x=>!x||x==='..'||x==='.'))throw Error('兼容源码路径无效');const allowed=name==='index.html'||['src/','public/','server/','plugins/mobile/'].some(prefix=>name.startsWith(prefix));if(!allowed)throw Error('兼容源码目标不受支持');const destination=join(root,name);await mkdir(dirname(destination),{recursive:true});await cp(join(source,name),destination);}
 }
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await fetchBuiltinPlugins(JSON.parse(await readFile(join(root,'plugins.lock.json'),'utf8')));
