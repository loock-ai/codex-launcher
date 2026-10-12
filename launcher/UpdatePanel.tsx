import {useEffect,useState,useRef} from 'react';
export interface DesktopUpdate {version:string;body?:string;download(progress:(received:number,total?:number)=>void):Promise<void>;install():Promise<void>;close?():Promise<void>}
export interface DesktopUpdater {info():Promise<{version:string;configured:boolean}>;check():Promise<DesktopUpdate|null>;stop():Promise<unknown>;relaunch():Promise<void>}
export function UpdatePanel({updater}:{updater:DesktopUpdater}) {
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 const [info,setInfo]=useState<{version:string;configured:boolean}>(),[update,setUpdate]=useState<DesktopUpdate|null>(null),[busy,setBusy]=useState(false),[downloaded,setDownloaded]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 useEffect(()=>()=>{void update?.close?.().catch(()=>{})},[update]);
 useEffect(()=>{updater.info().then(setInfo).catch(e=>setError(String(e)))},[updater]);
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
 return <section><h2>桌面更新</h2><p>当前版本：{info?.version??'读取中…'}</p>{info&&!info.configured&&<p>此开发包未配置更新签名，无法检查更新。</p>}<button disabled={busy||!info?.configured} onClick={()=>void run(async()=>{setDownloaded(false);setUpdate(null);const value=await updater.check();if(!mounted.current){await value?.close?.();return;}setUpdate(value);setMessage(value?'发现新版本':'已是最新版本')})}>检查更新</button>{update&&<><h3>新版本 {update.version}</h3><pre style={{whiteSpace:'pre-wrap'}}>{update.body||'此版本未提供更新说明。'}</pre>{!downloaded?<button disabled={busy} onClick={()=>void run(async()=>{await update.download((received,total)=>setMessage(total?`下载中 ${Math.floor(received/total*100)}%`:`已下载 ${Math.round(received/1024)} KB`));setDownloaded(true);setMessage('下载完成，签名验证通过。')})}>下载更新</button>:<button disabled={busy} onClick={()=>void run(async()=>{setMessage('正在停止后台并安装更新…');await updater.stop();try{await update.install();await updater.relaunch()}catch(e){setMessage('安装未完成，后台已停止。可以重试安装，或返回插件页手动启动插件。');throw e}})}>安装并重启</button>}</>}<p role="status">{message}</p>{error&&<p className="error" role="alert">{error}</p>}</section>
}
