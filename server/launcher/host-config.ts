import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,chmod,rm,link} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {defaultDesktopAppPath,isDesktopAppPath} from './platform.js';
import {validateConfig} from './config.js';
import type {DesktopSettings} from './plugin-contract.js';

export interface HostConfig {schemaVersion:2;desktop:DesktopSettings;}
export function validateHostConfig(value:HostConfig,platform:NodeJS.Platform=process.platform):HostConfig {
 if(!value||value.schemaVersion!==2)throw Error('无效启动器配置版本');
 const desktop=value.desktop;
 if(!desktop||!isDesktopAppPath(desktop.appPath,platform))throw Error(platform==='win32'?'Desktop 应用必须是绝对 .exe 路径':'Desktop 应用必须是绝对 .app 路径');
 if(!Number.isInteger(desktop.cdpPort)||desktop.cdpPort<1||desktop.cdpPort>65535)throw Error('CDP 端口必须是 1 到 65535 的整数');
 return {schemaVersion:2,desktop:{appPath:desktop.appPath,cdpPort:desktop.cdpPort}};
}
async function writePrivate(file:string,contents:string,exclusive=false){
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 const temp=`${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
 try {
  await writeFile(temp,contents,{flag:'wx',mode:0o600});await chmod(temp,0o600);
  if(exclusive){try{await link(temp,file);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}}
  else await rename(temp,file);
 }finally{await rm(temp,{force:true});}
}
export async function saveHostConfig(file:string,config:HostConfig){await writePrivate(file,JSON.stringify(validateHostConfig(config),null,2)+'\n');}
export async function loadHostConfig(file:string):Promise<HostConfig>{
 let contents:string;
 try{contents=await readFile(file,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;const initial:HostConfig={schemaVersion:2,desktop:{appPath:defaultDesktopAppPath(),cdpPort:9333}};await saveHostConfig(file,initial);return initial;}
 const raw=JSON.parse(contents);
 if(raw.schemaVersion===2)return validateHostConfig(raw);
 if(raw.schemaVersion!==undefined)throw Error('不支持的启动器配置版本');
 const legacy=validateConfig(raw);
 const next:HostConfig={schemaVersion:2,desktop:{appPath:legacy.appPath,cdpPort:legacy.cdpPort}};
 // Keep the original bytes first. Exclusive publication makes interrupted migration safe to repeat.
 await writePrivate(file+'.v1.bak',contents,true);
 const {mode,gatewayPort,appServerPort,host,token,upstreamUrl}=legacy;
 await writePrivate(join(dirname(file),'plugin-data/mobile/config.json'),JSON.stringify({mode,gatewayPort,appServerPort,host,token,upstreamUrl},null,2)+'\n',true);
 await saveHostConfig(file,next);return next;
}
