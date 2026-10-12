import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { accessSync,statSync,readFileSync,constants } from 'node:fs';
import { dirname } from 'node:path';
import {defaultDesktopAppPath,desktopResources,isDesktopAppPath,platformPath} from './platform.js';

export interface LauncherConfig {
  mode: 'cdp' | 'managed' | 'external';
  gatewayPort: number; cdpPort: number; appServerPort: number;
  host: '127.0.0.1' | '0.0.0.0'; token: string;
  appPath: string; cliPath: string; upstreamUrl: string;
}
export function desktopCliPath(appPath:string,platform:NodeJS.Platform=process.platform) {return platformPath(platform).join(desktopResources(appPath,platform),'codex-cli/bin',platform==='win32'?'codex.exe':'codex');}
export function desktopCliCandidates(appPath:string,platform:NodeJS.Platform=process.platform,manifest?:{layoutVersion?:unknown;entrypoint?:unknown}) {
 const path=platformPath(platform),resources=desktopResources(appPath,platform),base=path.join(resources,'codex-cli');let entry:string|null=null;
 if(manifest?.layoutVersion===1&&typeof manifest.entrypoint==='string'){const candidate=path.resolve(base,manifest.entrypoint),relative=path.relative(base,candidate);if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&(platform!=='win32'||/\.exe$/i.test(candidate)))entry=candidate;}
 return [...new Set([entry,desktopCliPath(appPath,platform),...(platform==='win32'?[path.join(base,'codex.exe')]:[]),path.join(resources,platform==='win32'?'codex.exe':'codex')].filter((value):value is string=>!!value))];
}
export function discoverDesktopCli(appPath:string,platform:NodeJS.Platform=process.platform) {
 const path=platformPath(platform);let manifest;try{manifest=JSON.parse(readFileSync(path.join(desktopResources(appPath,platform),'codex-cli/codex-package.json'),'utf8'));}catch{}
 for(const candidate of desktopCliCandidates(appPath,platform,manifest)) {try{accessSync(candidate,platform==='win32'?constants.F_OK:constants.X_OK);if(statSync(candidate).isFile())return candidate;}catch{}}
 throw new Error('未找到所选 Desktop 安装包的 CLI，请检查 ChatGPT 应用路径');
}
export function defaultConfig(platform:NodeJS.Platform=process.platform): LauncherConfig {
  return {mode:'cdp',gatewayPort:19877,cdpPort:9333,appServerPort:19876,host:'0.0.0.0',token:randomBytes(24).toString('hex'),appPath:defaultDesktopAppPath(platform),cliPath:desktopCliPath(defaultDesktopAppPath(platform),platform),upstreamUrl:'ws://127.0.0.1:18765'};
}
export function validateConfig(value: LauncherConfig,platform:NodeJS.Platform=process.platform): LauncherConfig {
  if (!value || !['cdp','managed','external'].includes(value.mode)) throw new Error('请选择有效的连接模式');
  for (const port of [value.gatewayPort,value.cdpPort,value.appServerPort]) if (!Number.isInteger(port) || port<1 || port>65535) throw new Error('端口必须是 1 到 65535 的整数');
  if (new Set([value.gatewayPort,value.cdpPort,value.appServerPort]).size!==3) throw new Error('网关、CDP 与 app-server 端口不能相同');
  if (!['127.0.0.1','0.0.0.0'].includes(value.host)) throw new Error('监听地址无效');
  if (typeof value.token!=='string' || value.token.length<16 || value.token.length>256) throw new Error('访问口令至少 16 个字符');
  if (!isDesktopAppPath(value.appPath,platform) || typeof value.cliPath!=='string' || !platformPath(platform).isAbsolute(value.cliPath)) throw new Error('应用与 Codex CLI 必须使用绝对路径');
  const url=new URL(value.upstreamUrl);
  if (!['ws:','wss:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password || url.hash) throw new Error('原 app-server 地址必须是本机 WebSocket');
  return {mode:value.mode,gatewayPort:value.gatewayPort,cdpPort:value.cdpPort,appServerPort:value.appServerPort,host:value.host,token:value.token,appPath:value.appPath,cliPath:desktopCliPath(value.appPath,platform),upstreamUrl:value.upstreamUrl};
}
export async function saveConfig(file: string, config: LauncherConfig) {
  const valid=validateConfig(config);await mkdir(dirname(file),{recursive:true,mode:0o700});
  const temp=`${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp,JSON.stringify(valid,null,2)+'\n',{mode:0o600});await chmod(temp,0o600);await rename(temp,file);
}
export async function loadConfig(file: string): Promise<LauncherConfig> {
  try {const raw=JSON.parse(await readFile(file,'utf8'));const config=validateConfig(raw);if(raw.cliPath!==config.cliPath)await saveConfig(file,config);return config;} catch(error) {
    if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;
    const config=defaultConfig();await saveConfig(file,config);return config;
  }
}
export function startArguments(config: LauncherConfig) {
  const c=validateConfig(config);
  return {command:c.mode==='cdp'?'control':'start',environment:{HOST:c.host,PORT:String(c.gatewayPort),CODEX_MOBILE_TOKEN:c.token,CODEX_MOBILE_CDP_URL:`http://127.0.0.1:${c.cdpPort}`,CODEX_APP_SERVER_MODE:c.mode==='external'?'external':'managed',CODEX_APP_SERVER_PORT:String(c.appServerPort),CODEX_APP_SERVER_URL:c.upstreamUrl}};
}
