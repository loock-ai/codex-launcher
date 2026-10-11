import {useEffect,useState,useRef} from 'react';
import type {PluginSnapshot} from '../server/launcher/script-plugins';
import QRCode from 'qrcode';
import type { LauncherConfig } from '../server/launcher/config';
import type { LauncherStatus } from '../server/launcher/controller';
export interface LauncherApi {
 listPlugins():Promise<PluginSnapshot>;setPluginEnabled(id:string,enabled:boolean):Promise<PluginSnapshot>;reloadPlugins():Promise<PluginSnapshot>;openPluginsFolder():Promise<void>;
 getStatus():Promise<LauncherStatus>;saveConfig(c:LauncherConfig):Promise<LauncherStatus>;start():Promise<LauncherStatus>;stop():Promise<LauncherStatus>;restart():Promise<LauncherStatus>;openDesktop():Promise<void>;copyUrl():Promise<void>;openMobile():Promise<void>;subscribe(fn:(s:LauncherStatus)=>void):()=>void;desktopStatus():Promise<any>;approve(id:string,choice:string):Promise<void>;
}
export function LauncherPanel({api}:{api:LauncherApi}) {
 const [plugins,setPlugins]=useState<PluginSnapshot|null>(null);const pluginRead=useRef(0);
 const pluginStateLabel={inactive:'未启用',waiting:'等待桌面连接',active:'已注入',error:'注入失败'};
 const [status,setStatus]=useState<LauncherStatus|null>(null),[config,setConfig]=useState<LauncherConfig|null>(null),[tab,setTab]=useState('连接'),[error,setError]=useState(''),[working,setWorking]=useState(false),[qr,setQr]=useState(''),[qrExpanded,setQrExpanded]=useState(false),[approvals,setApprovals]=useState<any[]>([]);
 useEffect(()=>{let alive=true;api.getStatus().then(s=>{if(alive){setStatus(s);setConfig(s.config);}}).catch(e=>setError(String(e)));const off=api.subscribe(s=>{if(alive)setStatus(s)});return()=>{alive=false;off();}},[api]);
 useEffect(()=>{let alive=true;if(!status?.accessUrl||!qrExpanded){setQr('');return;}setQr('');QRCode.toDataURL(status.accessUrl,{width:208,margin:2,errorCorrectionLevel:'M'}).then(s=>{if(alive)setQr(s)});return()=>{alive=false}},[status?.accessUrl,qrExpanded]);
 useEffect(()=>{if(!status?.running){setApprovals([]);return;}if(tab!=='审批')return;let alive=true;const load=()=>api.desktopStatus().then(s=>{if(alive)setApprovals(s?.approvals??[])}).catch(e=>{if(alive)setError(String(e))});void load();const timer=setInterval(()=>void load(),1000);return()=>{alive=false;clearInterval(timer)}},[api,tab,status?.running,status?.approvals]);
 useEffect(()=>{if(tab!=='插件')return;let alive=true,busy=false;const load=async()=>{if(busy)return;busy=true;const version=++pluginRead.current;try{const value=await api.listPlugins();if(alive&&version===pluginRead.current)setPlugins(value);}catch(error){if(alive&&version===pluginRead.current)setError(String(error));}finally{busy=false;}};void load();const timer=setInterval(()=>void load(),1500);return()=>{alive=false;clearInterval(timer);pluginRead.current++;};},[api,tab]);
 const run=async(action:()=>Promise<unknown>)=>{if(working)return;setWorking(true);setError('');try{const result=await action();if(result&&typeof result==='object'&&'config'in result)setStatus(result as LauncherStatus);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setWorking(false)}};
 if(!status||!config)return <main className="launcher"><p>正在读取启动器配置…</p>{error&&<p role="alert">{error}</p>}</main>;
 const update=<K extends keyof LauncherConfig>(key:K,value:LauncherConfig[K])=>setConfig({...config,[key]:value,...key==='appPath'?{cliPath:`${String(value).replace(/\/$/,'')}/Contents/Resources/codex-cli/bin/codex`}:{}});
 return <main className="launcher">
  <header><div className="brand-mark" aria-hidden="true">⌘</div><div><h1>Codex 启动器</h1><p>在 Web 中连接你的电脑</p></div><span className={'state '+(status.running?'online':'')}>{status.phase}</span></header>
  <nav aria-label="启动器页面">{['连接','插件','设置','审批','日志'].map(name=><button key={name} className={tab===name?'selected':''} onClick={()=>setTab(name)}>{name}{name==='审批'&&status.approvals>0?<b>{status.approvals}</b>:null}</button>)}</nav>
  {(error||status.error)&&<div className="error" role="alert">{(error||status.error).split('\n')[0].replace(/^page\.evaluate:\s*(?:Error:\s*)?/,'')}</div>}
  {tab==='连接'&&<section className="connection">
   <div className="connection-heading"><h2>{status.config.mode==='cdp'?'ChatGPT 桌面连接':'原 Codex Mobile'}</h2><span>{status.clients} 台设备</span></div>
   <p className="help">{status.config.mode==='cdp'?'在 Web 中查看桌面项目、会话并处理审批。':'通过 Codex app-server 使用原有 Web 功能。'}</p>
   {status.accessUrl?<div className="qr-section"><button className="qr-toggle" type="button" aria-expanded={qrExpanded} onClick={()=>setQrExpanded(value=>!value)}>{qrExpanded?'收起二维码':'展开二维码'}<span aria-hidden="true">{qrExpanded?'⌃':'⌄'}</span></button>{qrExpanded&&qr&&<img src={qr} width="208" height="208" alt="手机连接二维码"/>}<p>{new URL(status.accessUrl).hostname==='127.0.0.1'?'当前链接仅可在这台电脑打开':'手机与电脑连接同一网络，扫码打开'}</p><code>{new URL(status.accessUrl).origin}</code><div className="link-actions"><button onClick={()=>void run(()=>api.copyUrl())}>复制连接链接</button></div>{status.thread&&<p className="current-thread">当前会话：{status.thread}</p>}</div>:<div className="empty-connection"><span aria-hidden="true">▣ ↔ ▯</span><p>启动后打开 Web，并显示手机连接二维码</p></div>}
   <div className="main-actions"><button className="primary" disabled={working} onClick={()=>void run(async()=>{if(!status.running)setStatus(await api.start());await api.openMobile();})}>{working?'正在处理…':status.running?'打开 Web':'启动并打开 Web'}</button>{status.running&&<button disabled={working} onClick={()=>void run(()=>api.stop())}>停止连接</button>}{status.config.mode==='cdp'&&<button aria-label="强制重启 ChatGPT" disabled={working} onClick={()=>void run(()=>api.restart())}>强制重启</button>}<button disabled={working} onClick={()=>void run(()=>api.openDesktop())}>打开 ChatGPT</button></div>
   <p className="footnote">关闭面板后连接继续运行。停止连接会保留桌面应用。</p>
  </section>}
  {tab==='插件'&&<section className="plugins"><h2>桌面脚本插件</h2><p className="help">脚本保存在配置目录，开启后注入桌面；关闭后撤销。修改文件后点击重新加载。</p>
   <div className="plugin-actions"><button disabled={working} onClick={()=>void run(()=>api.openPluginsFolder())}>打开插件目录</button><button disabled={working} onClick={()=>void run(async()=>{pluginRead.current++;setPlugins(await api.reloadPlugins());})}>重新加载脚本</button></div>
   {plugins&&<code className="plugin-directory">{plugins.directory}</code>}
   {!plugins?<p className="help">正在读取插件…</p>:plugins.plugins.length===0?<p className="help">插件目录中暂无脚本插件。</p>:plugins.plugins.map(plugin=><article className="plugin-card" key={plugin.path}>
    <label className="plugin-toggle"><span><strong>{plugin.name}</strong><small>{plugin.version}</small></span><input type="checkbox" aria-label={'启用 '+plugin.name} checked={plugin.enabled} disabled={working} onChange={event=>{const enabled=event.target.checked;void run(async()=>{pluginRead.current++;setPlugins(await api.setPluginEnabled(plugin.id,enabled));});}}/></label>
    <p>{plugin.description}</p><span className={'plugin-state '+plugin.state}>{pluginStateLabel[plugin.state]}</span>{plugin.error&&<p className="plugin-error" role="alert">{plugin.error}</p>}
   </article>)}
  </section>}
  {tab==='设置'&&<section className="settings"><h2>连接配置</h2><fieldset disabled={working||status.running}>
   <label>连接模式<select aria-label="连接模式" value={config.mode} onChange={e=>update('mode',e.target.value as LauncherConfig['mode'])}><option value="cdp">CDP 桌面桥接</option><option value="managed">原 app-server · 启动本机服务</option><option value="external">原 app-server · 连接已有服务</option></select></label>
   <label>网关端口<input type="number" value={config.gatewayPort} onChange={e=>update('gatewayPort',Number(e.target.value))}/></label>
   <label>手机访问范围<select value={config.host} onChange={e=>update('host',e.target.value as LauncherConfig['host'])}><option value="0.0.0.0">局域网</option><option value="127.0.0.1">仅本机</option></select></label>
   <label>访问口令<input type="password" autoComplete="off" value={config.token} onChange={e=>update('token',e.target.value)}/></label>
   {config.mode!=='external'&&<label>ChatGPT 应用路径<input value={config.appPath} onChange={e=>update('appPath',e.target.value)}/></label>}
   {config.mode==='cdp'?<><label>CDP 端口<input type="number" value={config.cdpPort} onChange={e=>update('cdpPort',Number(e.target.value))}/></label></>:config.mode==='managed'?<><label>Desktop 内置 CLI 路径<input value={config.cliPath} readOnly/></label><label>app-server 端口<input type="number" value={config.appServerPort} onChange={e=>update('appServerPort',Number(e.target.value))}/></label></>:<label>已有 app-server 地址<input value={config.upstreamUrl} onChange={e=>update('upstreamUrl',e.target.value)}/></label>}
   <button className="primary" onClick={()=>void run(async()=>{const s=await api.saveConfig(config);setConfig(s.config);return s})}>保存配置</button>
  </fieldset><p className="footnote">{status.running?'先停止连接，再修改配置。':'配置保存在本机，默认不开机启动。'}</p></section>}
  {tab==='审批'&&<section><h2>等待你的决定</h2>{!approvals.length?<p className="help">没有待处理审批。原 app-server 模式请在 Web 中处理审批。</p>:<><p className="help">请在 Web 中打开对应会话，查看完整请求并回答。</p>{approvals.map(a=><article className="approval" key={a.id}><pre>{a.method}</pre>{a.params?.threadId&&<p>会话：{a.params.threadId}</p>}</article>)}<button className="primary" disabled={working} onClick={()=>void run(()=>api.openMobile())}>在 Web 中处理审批</button></>}</section>}
  {tab==='日志'&&<section><h2>启动诊断</h2><pre className="logs">{status.logs.join('\n')||'尚无启动记录'}</pre><p className="footnote">日志隐藏访问口令，连接失败原因会显示在上方。</p></section>}
 </main>;
}
