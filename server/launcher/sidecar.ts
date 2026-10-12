import {Console} from 'node:console';
import {Writable} from 'node:stream';
import {LauncherDiagnostics} from './diagnostics.js';
import {readFile} from 'node:fs/promises';
import {extname,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LauncherController} from './controller.js';
import type {DesktopSettings} from './plugin-contract.js';
import {systemOpenCommand,clipboardCommand,runPlatformCommand} from './platform.js';
function pluginCsp(id:string){
 // 沙箱 iframe 的自定义协议在 WebKit 中不能仅依赖 'self' 匹配资源。
 const path=encodeURIComponent(id)+'/',sources=`launcher-plugin://plugin/${path} http://launcher-plugin.localhost/${path}`;
 return `default-src 'none'; script-src 'self' ${sources}; style-src 'self' ${sources}; img-src 'self' ${sources} data:; font-src 'self' ${sources}; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
}
const MIME:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.woff':'font/woff','.woff2':'font/woff2'};
const invalid=()=>Object.assign(Error('无效调用参数'),{code:'INVALID_PARAMS'});
function id(value:unknown):asserts value is string{if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value))throw invalid();}
function count(args:unknown[],n:number){if(args.length!==n)throw invalid();}
async function writeClipboard(text:string){await runPlatformCommand(clipboardCommand(text));}
/** 只暴露固定 UI 方法；不能访问 EventEmitter 或内部控制器对象。 */
export async function dispatchSidecar(controller:LauncherController,method:string,args:unknown[]):Promise<unknown>{
 switch(method){
  case 'status':count(args,0);return controller.status();
  case 'uninstallPlugin':count(args,1);id(args[0]);return controller.uninstallPlugin(args[0]);
  case 'listPluginRepositories':count(args,0);return controller.listPluginRepositories();
  case 'addPluginRepository':count(args,1);return controller.addPluginRepository(args[0] as any);
  case 'editPluginRepository':count(args,2);id(args[0]);return controller.editPluginRepository(args[0],args[1] as any);
  case 'setPluginRepositoryEnabled':count(args,2);id(args[0]);return controller.setPluginRepositoryEnabled(args[0],args[1] as boolean);
  case 'removePluginRepository':count(args,1);id(args[0]);return controller.removePluginRepository(args[0]);
  case 'checkPluginUpdates':count(args,0);return controller.checkPluginUpdates();
  case 'updatePlugin':count(args,2);id(args[0]);return controller.updatePlugin(args[0],args[1] as {allowLocalChanges?:boolean});
  case 'listPlugins':count(args,0);return controller.listPlugins();
  case 'start':count(args,0);return controller.start();
  case 'stop':count(args,0);return controller.stop();
  case 'reloadPlugins':count(args,0);return controller.reloadPlugins();
  case 'openDesktop':count(args,0);return controller.openDesktop();
  case 'connectDesktop':count(args,0);return controller.connectDesktop();
  case 'restartDesktop':count(args,0);return controller.restartDesktop();
  case 'openPluginsFolder':count(args,0);await runPlatformCommand(systemOpenCommand(controller.pluginDirectory()));return null;
  case 'setPluginEnabled':case 'setPluginAutoStart':{
   count(args,2);id(args[0]);if(typeof args[1]!=='boolean')throw invalid();return method==='setPluginEnabled'?controller.setPluginEnabled(args[0],args[1]):controller.setPluginAutoStart(args[0],args[1]);
  }
  case 'startPlugin':case 'stopPlugin':case 'pluginUiUrl':{
   count(args,1);id(args[0]);return method==='startPlugin'?controller.startPlugin(args[0]):method==='stopPlugin'?controller.stopPlugin(args[0]):controller.pluginUiUrl(args[0]);
  }
  case 'invokePlugin':count(args,3);id(args[0]);if(typeof args[1]!=='string'||!args[1]||args[1].length>200)throw invalid();return controller.invokePlugin(args[0],args[1],args[2]);
  case 'saveDesktopSettings':{
   count(args,1);const value=args[0] as DesktopSettings|null;if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.appPath!=='string'||!Number.isInteger(value.cdpPort))throw invalid();return controller.saveDesktopSettings(value);
  }
  case 'pluginUiAsset':{
   count(args,2);id(args[0]);if(typeof args[1]!=='string'||!args[1]||args[1].length>4096||args[1].split('/').some(s=>!s||s==='.'||s==='..'||/[\\\0]/.test(s)))throw invalid();
   const file=await controller.resolvePluginUiAsset(args[0],args[1]);return {body:(await readFile(file)).toString('base64'),mime:MIME[extname(file).toLowerCase()]??'application/octet-stream',csp:pluginCsp(args[0])};
  }
  default:throw Object.assign(Error('不支持的调用方法'),{code:'METHOD_NOT_FOUND'});
 }
}
function options(argv:string[]){let config='',root='',noDesktop=false;for(let i=0;i<argv.length;i++){const arg=argv[i];if(arg==='--config'||arg==='--root'){const value=argv[++i];if(!value||!isAbsolute(value))throw Error(arg+' 必须为绝对路径');if(arg==='--config')config=value;else root=value;}else if(arg==='--no-desktop')noDesktop=true;else if(arg!=='--no-auto-start')throw Error('未知启动参数: '+arg);}if(!config||!root)throw Error('必须指定 --config 和 --root');return {config,root,noDesktop};}
export async function runSidecar(argv=process.argv.slice(2)){
 const opt=options(argv);const diagnostics=new LauncherDiagnostics(opt.config);
 // stdout 是宿主协议专用通道，普通日志保留 stderr 并记录脱敏诊断摘要。
 const logStream=new Writable({write(chunk,_encoding,done){process.stderr.write(chunk);diagnostics.append(String(chunk).trim());done();}});
 globalThis.console=new Console({stdout:logStream,stderr:logStream});
 const disabled=async()=>{throw Error('测试模式已禁用 Desktop')};
 const controller=new LauncherController(opt.config,opt.root,{...(opt.noDesktop?{desktop:{ensure:disabled,open:disabled,restart:disabled}}:{}),system:{async openExternal(raw){const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw invalid();await runPlatformCommand(systemOpenCommand(url.href));},writeClipboard}});
 diagnostics.setSnapshotSource(()=>({status:controller.status(),plugins:controller.listPlugins().plugins}));
 let closing=false,forced=false,chain=Promise.resolve(),shutdown:Promise<void>|undefined;
 const send=(message:unknown)=>{if(!process.stdout.destroyed)process.stdout.write(JSON.stringify(message)+'\n');};
 controller.on('status',data=>{send({event:'status',data});diagnostics.schedule();});
 const initialized=controller.initialize();
 const close=()=>shutdown??=(async()=>{
  closing=true;process.stdin.pause();
  const deadline=setTimeout(()=>{forced=true;console.error('退出宽限期耗尽，强制回收插件进程组；异步清理未完成');controller.forceStop();setTimeout(()=>process.exit(1),100);},10000);
  try{await initialized.catch(()=>{});await chain;await controller.stop();}
  catch(e){console.error(e);process.exitCode=1;}
  finally{await diagnostics.flush(1000);clearTimeout(deadline);process.stdin.destroy();}
 })();
 process.once('SIGTERM',()=>{void close();});process.once('SIGINT',()=>{void close();});
 process.stdout.on('error',()=>{void close();});process.stdin.on('error',()=>{void close();});
 try{await initialized;diagnostics.schedule();}catch(error){diagnostics.recordError('initialize',error);await close();throw error;}
 if(closing)return shutdown;
 send({event:'ready'});
 let buffer='';const maxLine=1024*1024;
 process.stdin.setEncoding('utf8');
 const accept=(line:string)=>{
  if(closing||!line.trim())return;
  let request:{id:string|number;method:string;args:unknown[]};
  try{request=JSON.parse(line);if(!request||!(typeof request.id==='string'||typeof request.id==='number')||typeof request.method!=='string'||!Array.isArray(request.args))throw invalid();}
  catch{const error={message:'无效 JSON 请求',code:'INVALID_REQUEST'};diagnostics.recordError('request',error);send({id:null,error});return;}
  if(request.method==='shutdown'){
   try{count(request.args,0);}catch{const error={message:'无效调用参数',code:'INVALID_PARAMS'};diagnostics.recordError('shutdown',error);send({id:request.id,error});return;}
   void close().then(()=>send(forced?{id:request.id,error:{message:'退出超时，已强制回收插件进程组',code:'SHUTDOWN_FORCED'}}:{id:request.id,result:null}));return;
  }
  chain=chain.then(async()=>{
   try{
    if(closing)throw Object.assign(Error('后台正在退出'),{code:'SHUTTING_DOWN'});
    let result:unknown;
    if(request.method==='reportError'){
     count(request.args,1);const value=request.args[0] as Record<string,unknown>|null;
     if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['message','source'].includes(k))||typeof value.message!=='string'||value.message.length>4000||(value.source!==undefined&&(typeof value.source!=='string'||value.source.length>100)))throw invalid();
     diagnostics.recordError(typeof value.source==='string'?value.source:'reportError',{message:value.message});result=null;
    }else result=await dispatchSidecar(controller,request.method,request.args);
    send({id:request.id,result:result??null});
   }catch(error){
    diagnostics.recordError(request.method,error);const e=error as {message?:string;code?:string};
    send({id:request.id,error:{message:e?.message??String(error),...(typeof e?.code==='string'?{code:e.code}:{})}});
   }
  });
 };
 process.stdin.on('data',(chunk:string)=>{if(closing)return;buffer+=chunk;let n;while((n=buffer.indexOf('\n'))>=0){if(n>maxLine){console.error('协议请求过大');void close();return;}const line=buffer.slice(0,n);buffer=buffer.slice(n+1);accept(line);}if(buffer.length>maxLine){console.error('协议请求过大');void close();}});
 process.stdin.once('end',()=>{if(buffer.trim())console.error('忽略未完整传输的协议请求');void close();});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void runSidecar().catch(error=>{console.error(error);process.exitCode=1;});
