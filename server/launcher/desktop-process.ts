import {parseDesktopProcessIds,processQueryCommand,runPlatformCommand,killTreeCommand} from './platform.js';
export function desktopProcessIds(output:string,executable:string){return parseDesktopProcessIds(output,executable,'darwin');}
export async function runningDesktopProcessIds(executable:string,platform:NodeJS.Platform=process.platform){return parseDesktopProcessIds(await runPlatformCommand(processQueryCommand(platform),5000),executable,platform);}
/** 精确匹配配置的可执行文件路径，只终止对应 PID 及其子进程。 */
export async function forceStopDesktop(executable:string,platform:NodeJS.Platform=process.platform,shouldContinue?:()=>boolean){
 const read=()=>runningDesktopProcessIds(executable,platform);
 for(const pid of await read()){
  if(shouldContinue&&!shouldContinue())return;
  if(platform==='win32'){try{await runPlatformCommand(killTreeCommand(pid,platform),5000);}catch(error){if((await read()).includes(pid))throw error;}}
  else try{process.kill(pid,'SIGKILL');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
 }
 const end=Date.now()+10000;
 while((await read()).length){if(shouldContinue&&!shouldContinue())return;if(Date.now()>=end)throw new Error('ChatGPT 主进程尚未退出，请重试');await new Promise(resolve=>setTimeout(resolve,100));}
}
