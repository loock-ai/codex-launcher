import {createRequire} from 'node:module';import {createWriteStream} from 'node:fs';import {pipeline} from 'node:stream/promises';
import {mkdir,readdir,lstat,readFile,writeFile,rename,rm,mkdtemp,access} from 'node:fs/promises';import {join,dirname,relative,resolve,sep} from 'node:path';import {createHash,randomBytes} from 'node:crypto';
import {downloadPluginBytes,validatePluginCatalog,compareVersions,type CatalogPlugin,githubRepository,OFFICIAL_PLUGIN_REPOSITORY} from './plugin-catalog.js';
const yauzl=createRequire(import.meta.url)('yauzl');
const limit=300*1024*1024;
export async function extractPluginZip(bytes:Buffer,directory:string){
 if(bytes.length>100*1024*1024)throw Error('插件包超过100 MiB');await mkdir(directory,{recursive:true,mode:0o700});
 await new Promise<void>((ok,no)=>{yauzl.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(error:Error,zip:any)=>{
  if(error){no(error);return;}let total=0,count=0,ended=false;const names=new Set<string>();const fail=(e:unknown)=>{if(ended)return;ended=true;zip.close();no(e)};zip.on('error',fail);zip.on('end',()=>{if(!ended){ended=true;ok()}});
  zip.on('entry',(entry:any)=>{void(async()=>{
   const name=entry.fileName as string;const parts=name.replace(/\/$/,'').split('/');const key=name.toLowerCase();
   if(!name||name.startsWith('/')||parts.some(x=>!x||x==='.'||x==='..'||/[\\:\x00<>"|?*]/.test(x)||/[. ]$/.test(x)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x))||names.has(key))throw Error('ZIP路径或重复文件无效');names.add(key);
   if((entry.externalFileAttributes>>>16&0xf000)===0xa000||entry.generalPurposeBitFlag&1)throw Error('ZIP不支持符号链接或加密');
   total+=entry.uncompressedSize;if(++count>20000||total>limit)throw Error('ZIP解压超过限制');const target=resolve(directory,name);if(!target.startsWith(resolve(directory)+sep))throw Error('ZIP路径逃逸');
   if(name.endsWith('/'))await mkdir(target,{recursive:true,mode:0o700});else{
    await mkdir(dirname(target),{recursive:true,mode:0o700});const stream=await new Promise<any>((yes,bad)=>zip.openReadStream(entry,(e:Error,s:any)=>e?bad(e):yes(s)));await pipeline(stream,createWriteStream(target,{flags:'wx',mode:0o600}));
   }zip.readEntry();
  })().catch(fail)});zip.readEntry();
 });});
}
async function exists(path:string){try{await lstat(path);return true}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e}}
export async function pluginTreeHash(directory:string){const hash=createHash('sha256');let count=0,total=0;async function walk(dir:string){for(const ent of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(dir,ent.name);if(ent.isSymbolicLink())throw Error('本地插件含符号链接');if(ent.isDirectory())await walk(path);else if(ent.isFile()){const data=await readFile(path);total+=data.length;if(++count>20000||total>limit)throw Error('本地插件超过限制');hash.update(relative(directory,path).split(sep).join('/'));hash.update('\0');hash.update(data);hash.update('\0');}else throw Error('本地插件含特殊文件');}}await walk(directory);return hash.digest('hex');}
interface Lifecycle{snapshot?():unknown;restorePolicy?(snapshot:unknown):Promise<unknown>;stop(id:string):Promise<unknown>;reload(id:string):Promise<unknown>;restore(id:string):Promise<unknown>}
export class PluginInstaller{
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private root:string,private lifecycle:Lifecycle,private download:(url:string)=>Promise<Buffer>=downloadPluginBytes){}
 private registryPath(){return join(this.root,'plugin-installations.json')}
 private async registry():Promise<Record<string,{version:string;codeHash:string;sourceRepository?:string}>>{try{return JSON.parse(await readFile(this.registryPath(),'utf8'))}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {};throw e}}
 async forgetInstallation(id:string){const registry=await this.registry();delete registry[id];const temp=this.registryPath()+'.'+randomBytes(8).toString('hex')+'.tmp';try{await writeFile(temp,JSON.stringify(registry,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,this.registryPath())}finally{await rm(temp,{force:true})}}
 async sourceRepository(id:string){const record=(await this.registry())[id];return record?(record.sourceRepository??OFFICIAL_PLUGIN_REPOSITORY):undefined;}
 async directoryIssue(id:string):Promise<string|undefined>{
  let dirs;try{dirs=await readdir(join(this.root,'plugins'),{withFileTypes:true})}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e}
  for(const dir of dirs){
   if(dir.name===id&&(!dir.isDirectory()||dir.isSymbolicLink()))return '目标插件目录不是普通目录';
   if(!dir.isDirectory()||dir.isSymbolicLink())continue;
   let manifest;try{manifest=JSON.parse(await readFile(join(this.root,'plugins',dir.name,'manifest.json'),'utf8'))}catch{if(dir.name===id)return '目标插件目录缺少有效manifest';continue}
   if(manifest?.id===id&&dir.name!==id)return `目录 ${dir.name} 与插件 ID ${id} 不一致，请先重命名目录后更新`;
   if(dir.name===id&&manifest?.id!==id)return '目标插件目录已被其他插件ID占用';
  }
 }
 async isModified(id:string){if(await this.directoryIssue(id))return true;const path=join(this.root,'plugins',id);if(!await exists(path))return false;const r=(await this.registry())[id];if(!r)return true;return r.codeHash!==await pluginTreeHash(path);}
 install(plugin:CatalogPlugin,options:{allowLocalChanges?:boolean}={}){const work=this.queue.then(()=>this.perform(plugin,options));this.queue=work.catch(()=>{});return work;}
 private async perform(plugin:CatalogPlugin,options:{allowLocalChanges?:boolean}){
  const repository=githubRepository(plugin.git?.url);validatePluginCatalog({schemaVersion:1,repository,plugins:[plugin]},repository);const owner=await this.sourceRepository(plugin.id);if(owner&&owner!==repository)throw Error('插件已绑定其他来源仓库，不能静默替换');if(plugin.compatibility.launcherApiVersion!=='1')throw Error('插件需要新版宿主API，请升级Launcher');
  const directoryIssue=await this.directoryIssue(plugin.id);if(directoryIssue)throw Error(directoryIssue);
  const bytes=await this.download(plugin.release.url);if(createHash('sha256').update(bytes).digest('hex')!==plugin.release.sha256)throw Error('插件包哈希校验失败');
  const target=join(this.root,'plugins',plugin.id);const hadOld=await exists(target);if(hadOld&&await this.isModified(plugin.id)&&!options.allowLocalChanges)throw Object.assign(Error('本地插件有修改或来源未记录，请确认保留备份后更新'),{code:'LOCAL_CHANGES'});
  if(hadOld){const old=JSON.parse(await readFile(join(target,'manifest.json'),'utf8'));if(compareVersions(plugin.version,old.version)<0)throw Error('禁止降级插件');}
  await mkdir(this.root,{recursive:true,mode:0o700});const stage=await mkdtemp(join(this.root,'.plugin-install-'));let moved=false,switched=false;
  const backup=join(this.root,'plugin-backups',plugin.id,Date.now()+'-'+randomBytes(4).toString('hex'));const registry=await this.registry();const policy=this.lifecycle.snapshot?.();
  try{
   await extractPluginZip(bytes,stage);const manifest=JSON.parse(await readFile(join(stage,'manifest.json'),'utf8'));
   if(manifest.id!==plugin.id||manifest.version!==plugin.version||(manifest.launcherApiVersion??'1')!==plugin.compatibility.launcherApiVersion)throw Error('插件manifest身份、版本或API不一致');
   const entries=manifest.entrypoints??{desktop:manifest.entry};if(!entries||!Object.values(entries).some(Boolean))throw Error('插件manifest没有入口');
   for(const key of ['main','ui','desktop'])if(entries[key]){const entry=entries[key];if(typeof entry!=='string'||entry.split(/[\\/]/).some((p:string)=>!p||p==='.'||p==='..')||/^[\/\\]|:|\x00/.test(entry))throw Error('插件manifest入口无效');const path=join(stage,entry);if(!(await lstat(path)).isFile())throw Error('插件manifest入口不是文件');}
   const codeHash=await pluginTreeHash(stage);await this.lifecycle.stop(plugin.id);
   if(hadOld){await mkdir(dirname(backup),{recursive:true,mode:0o700});await rename(target,backup);moved=true;}await mkdir(dirname(target),{recursive:true,mode:0o700});await rename(stage,target);switched=true;
   await this.lifecycle.reload(plugin.id);await this.lifecycle.restore(plugin.id);
   const next={...registry,[plugin.id]:{version:plugin.version,codeHash,sourceRepository:repository}};const temp=this.registryPath()+'.'+randomBytes(8).toString('hex')+'.tmp';try{await writeFile(temp,JSON.stringify(next,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,this.registryPath())}finally{await rm(temp,{force:true})}
   return {id:plugin.id,version:plugin.version,...(moved?{backup}:{}),installed:true};
  }catch(error){if(switched||moved){try{await this.lifecycle.stop(plugin.id);if(switched)await rm(target,{recursive:true,force:true});if(moved)await rename(backup,target);if(this.lifecycle.restorePolicy)await this.lifecycle.restorePolicy(policy);await this.lifecycle.reload(plugin.id);await this.lifecycle.restore(plugin.id);}catch(rollback){throw new Error(`插件更新失败：${String(error)}；回滚未完全恢复：${String(rollback)}；备份：${backup}`)}}throw error;
  }finally{await rm(stage,{recursive:true,force:true})}
 }
}
