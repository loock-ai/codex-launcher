import {readFile} from 'node:fs/promises';import {join} from 'node:path';
import type {PluginSummary} from './plugin-contract.js';
export const PLUGIN_CATALOG_URL='https://raw.githubusercontent.com/loock-ai/codex-launcher-plugins/main/plugins.json';
export interface CatalogPlugin{id:string;name:string;description:string;version:string;git:{url:string;path:string;ref:string;commit:string};compatibility:{launcherApiVersion:string;node:string};release:{url:string;sha256:string}}
export interface Catalog{schemaVersion:1;repository:string;plugins:CatalogPlugin[]}
export interface PluginUpdate extends CatalogPlugin{installedVersion?:string;updateAvailable:boolean;compatible:boolean;locallyModified:boolean;blockedReason?:string}
export const versionPattern=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function compareVersions(a:string,b:string){if(!versionPattern.test(a)||!versionPattern.test(b))throw Error('插件版本无效');const x=a.split('.').map(Number),y=b.split('.').map(Number);return x[0]-y[0]||x[1]-y[1]||x[2]-y[2];}
export function validatePluginCatalog(raw:unknown):Catalog{
 const v=raw as Catalog;if(!v||v.schemaVersion!==1||v.repository!=='https://github.com/loock-ai/codex-launcher-plugins'||!Array.isArray(v.plugins)||v.plugins.length>200)throw Error('插件目录格式无效');
 const seen=new Set();for(const p of v.plugins){
  if(!p||typeof p.id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(p.id)||seen.has(p.id)||typeof p.name!=='string'||!p.name||p.name.length>100||typeof p.description!=='string'||p.description.length>1000||typeof p.version!=='string'||!versionPattern.test(p.version))throw Error('插件身份或版本无效');seen.add(p.id);
  if(p.git?.url!==v.repository+'.git'||p.git.path!==`plugins/${p.id}`||p.git.ref!==`${p.id}-v${p.version}`||! /^[a-f0-9]{40}$/.test(p.git.commit??'')||!/^[1-9]\d*$/.test(p.compatibility?.launcherApiVersion??'')||p.compatibility?.node!=='>=20'||p.release?.url!==`${v.repository}/releases/download/${p.git.ref}/${p.id}-${p.version}.zip`||!/^[a-f0-9]{64}$/.test(p.release.sha256??''))throw Error('插件源码或发布信息无效');
 }return v;
}
export async function downloadPluginBytes(url:string,limit=100*1024*1024):Promise<Buffer>{
 const response=await fetch(url,{signal:AbortSignal.timeout(60000),redirect:'follow'});if(!response.ok||!response.body)throw Error('插件下载失败: '+response.status);
 const final=new URL(response.url);if(final.protocol!=='https:'||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','raw.githubusercontent.com'].includes(final.hostname))throw Error('插件下载重定向来源无效');
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let length=0;try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw Error('插件下载超过大小限制');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}return Buffer.concat(chunks);
}
export class PluginCatalog{
 constructor(private load:()=>Promise<unknown>=async()=>JSON.parse((await downloadPluginBytes(PLUGIN_CATALOG_URL,2*1024*1024)).toString('utf8'))){}
 async read(){return validatePluginCatalog(await this.load());}
 async check(installed:PluginSummary[],isModified:(id:string)=>Promise<boolean>):Promise<PluginUpdate[]>{const catalog=await this.read();return Promise.all(catalog.plugins.map(async p=>{const local=installed.find(x=>x.id===p.id);return {...p,installedVersion:local?.version,updateAvailable:!local||compareVersions(p.version,local.version)>0,compatible:p.compatibility.launcherApiVersion==='1',locallyModified:!!local&&await isModified(p.id)};}));}
}
