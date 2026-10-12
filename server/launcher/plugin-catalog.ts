import type {PluginSummary} from './plugin-contract.js';
export const OFFICIAL_PLUGIN_REPOSITORY='https://github.com/loock-ai/codex-launcher-plugins';
export const PLUGIN_CATALOG_URL='https://raw.githubusercontent.com/loock-ai/codex-launcher-plugins/main/plugins.json';
export function githubRepository(value:string){
 if(typeof value!=='string'||value.length>300)throw Error('仓库地址无效');let text=value.trim();if(!text.startsWith('https://')){if(text.includes('://'))throw Error('仅支持公开GitHub HTTPS仓库');text='https://github.com/'+text;}
 let u:URL;try{u=new URL(text)}catch{throw Error('仓库地址无效')}
 const parts=u.pathname.replace(/\/$/,'').replace(/\.git$/,'').split('/').filter(Boolean);
 if(u.protocol!=='https:'||u.hostname!=='github.com'||u.port||u.username||u.password||u.search||u.hash||parts.length!==2||!parts.every(p=>/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(p)&&p!=='.'&&p!=='..'))throw Error('仅支持公开GitHub仓库地址或 owner/repo');
 return 'https://github.com/'+parts.join('/').toLowerCase();
}
export interface CatalogPlugin{id:string;name:string;description:string;version:string;git:{url:string;path:string;ref:string;commit:string};compatibility:{launcherApiVersion:string;node:string};release:{url:string;sha256:string};sourceRepository?:string}
export interface Catalog{schemaVersion:1;repository:string;plugins:CatalogPlugin[]}
export interface PluginUpdate extends CatalogPlugin{installedVersion?:string;updateAvailable:boolean;compatible:boolean;locallyModified:boolean;blockedReason?:string;sourceConflict?:boolean}
export const versionPattern=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function compareVersions(a:string,b:string){if(!versionPattern.test(a)||!versionPattern.test(b)||![...a.split('.'),...b.split('.')].every(n=>Number.isSafeInteger(Number(n))))throw Error('插件版本无效');const x=a.split('.').map(Number),y=b.split('.').map(Number);return x[0]-y[0]||x[1]-y[1]||x[2]-y[2];}
export function validatePluginCatalog(raw:unknown,expectedRepository?:string):Catalog{
 const v=raw as Catalog;if(!v||v.schemaVersion!==1||!Array.isArray(v.plugins)||v.plugins.length>200)throw Error('插件目录格式无效');const repository=githubRepository(v.repository);if(expectedRepository&&repository!==githubRepository(expectedRepository))throw Error('目录声明的仓库与配置来源不一致');
 const seen=new Set();for(const p of v.plugins){
  if(!p||typeof p.id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(p.id)||seen.has(p.id)||typeof p.name!=='string'||!p.name||p.name.length>100||typeof p.description!=='string'||p.description.length>1000||typeof p.version!=='string')throw Error('插件身份或版本无效');compareVersions(p.version,p.version);seen.add(p.id);
  const path=p.git?.path;const ref=p.git?.ref;
  if(githubRepository(p.git?.url)!==repository||typeof path!=='string'||path.length>256||(path!=='.'&&path.split(/[\\/]/).some(x=>!x||x==='.'||x==='..'||x.includes(':')))||path.startsWith('/')||typeof ref!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_./-]{0,127}$/.test(ref)||ref.includes('..')||! /^[a-f0-9]{40}$/.test(p.git.commit??'')||!/^[1-9]\d*$/.test(p.compatibility?.launcherApiVersion??'')||p.compatibility?.node!=='>=20'||!/^[a-f0-9]{64}$/.test(p.release?.sha256??''))throw Error('插件源码或发布信息无效');
  let asset:URL;try{asset=new URL(p.release.url)}catch{throw Error('插件发布地址无效')};const bits=asset.pathname.split('/').filter(Boolean);
  if(asset.protocol!=='https:'||asset.hostname!=='github.com'||asset.port||asset.username||asset.password||asset.search||asset.hash||bits.length!==6||githubRepository(bits.slice(0,2).join('/'))!==repository||bits[2]!=='releases'||bits[3]!=='download'||!bits[5].endsWith('.zip'))throw Error('插件发布包必须来自声明仓库的GitHub Release');
 }return {...v,repository,plugins:v.plugins.map(p=>({...p,sourceRepository:repository}))};
}
export async function downloadPluginBytes(url:string,limit=100*1024*1024):Promise<Buffer>{
 const response=await fetch(url,{signal:AbortSignal.timeout(60000),redirect:'follow'});if(!response.ok||!response.body)throw Error('插件下载失败: '+response.status);
 const final=new URL(response.url);if(final.protocol!=='https:'||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','raw.githubusercontent.com'].includes(final.hostname))throw Error('插件下载重定向来源无效');
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let length=0;try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw Error('插件下载超过大小限制');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}return Buffer.concat(chunks);
}
export class PluginCatalog{
 constructor(private load?:()=>Promise<unknown>,private repository=OFFICIAL_PLUGIN_REPOSITORY,private branch='main'){}
 async read(){const repo=githubRepository(this.repository);const data=this.load?await this.load():JSON.parse((await downloadPluginBytes(`https://raw.githubusercontent.com/${repo.slice('https://github.com/'.length)}/${encodeURIComponent(this.branch)}/plugins.json`,2*1024*1024)).toString('utf8'));return validatePluginCatalog(data,repo);}
 async check(installed:PluginSummary[],isModified:(id:string)=>Promise<boolean>):Promise<PluginUpdate[]>{const catalog=await this.read();return Promise.all(catalog.plugins.map(async p=>{const local=installed.find(x=>x.id===p.id);return {...p,installedVersion:local?.version,updateAvailable:!local||compareVersions(p.version,local.version)>0,compatible:p.compatibility.launcherApiVersion==='1',locallyModified:!!local&&await isModified(p.id)};}));}
}
