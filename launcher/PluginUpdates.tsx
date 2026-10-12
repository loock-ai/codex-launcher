import {useState} from 'react';import type {PluginUpdate} from '../server/launcher/plugin-catalog';
import type {LauncherApi} from './Panel';
export function PluginUpdates({api,onChanged}:{api:LauncherApi;onChanged:()=>void}){
 const [items,setItems]=useState<PluginUpdate[]>([]),[busy,setBusy]=useState(false),[checked,setChecked]=useState(false),[message,setMessage]=useState('');
 if(!api.checkPluginUpdates||!api.updatePlugin)return null;
 const check=async()=>{setBusy(true);setMessage('');try{setItems(await api.checkPluginUpdates!());setChecked(true)}catch(e){setMessage(String(e instanceof Error?e.message:e))}finally{setBusy(false)}};
 const update=async(p:PluginUpdate)=>{setBusy(true);setMessage('');try{await api.updatePlugin!(p.id,{allowLocalChanges:p.locallyModified});onChanged();setItems(await api.checkPluginUpdates!());setMessage(`${p.name} 已更新至 ${p.version}`)}catch(e){setMessage(String(e instanceof Error?e.message:e))}finally{setBusy(false)}};
 return <div className="plugin-updates"><button disabled={busy} onClick={()=>void check()}>{busy?'正在处理…':'检查插件更新'}</button>{checked&&!items.some(p=>p.updateAvailable)&&<span>插件均为最新版本</span>}{items.filter(p=>p.updateAvailable).map(p=><article className="plugin-update" key={p.id}><strong>{p.name} · {p.installedVersion??'未安装'} → {p.version}</strong><p>{p.description}</p>{p.blockedReason?<p>{p.blockedReason}</p>:!p.compatible?<p>需要升级 Launcher 才能使用此插件 API。</p>:<>{p.locallyModified&&<p>现有代码含本地修改或未记录来源，将先保留完整备份。</p>}<button disabled={busy} onClick={()=>void update(p)}>{p.locallyModified?'保留备份并更新':p.installedVersion?'更新插件':'安装插件'}</button></>}<a href={p.git.url.replace(/\.git$/,'')} target="_blank" rel="noreferrer">查看源码</a></article>)}{message&&<p role="status">{message}</p>}</div>;
}
