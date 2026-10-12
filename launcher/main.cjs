const {app,Tray,Menu,BrowserWindow,nativeImage,ipcMain,clipboard,shell,dialog,protocol}=require('electron');
const path=require('node:path');
protocol.registerSchemesAsPrivileged([{scheme:'launcher-plugin',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
app.setName('Codex 启动器');
// 名称调整不迁移用户配置、插件和单实例锁目录。
app.setPath('userData',path.join(app.getPath('appData'),'codex-mobile'));
let tray,panel,controller,quitting=false;
const {createCommandHandler}=require('./commands.cjs');
let resolveReady,rejectReady;
const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
ready.catch(()=>{});
const openWeb=()=>controller.invokePlugin('mobile','open-web',{});
const runCommand=createCommandHandler({ready,start:()=>controller.start(),openWeb,showPanel});
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',(_event,argv)=>{void runCommand(argv).catch(showError);});
 app.whenReady().then(async()=>{
  app.dock?.hide();
  const root=path.resolve(__dirname,'..');
  const {LauncherController}=await import(path.join(root,'npm-dist/server/launcher/controller.js'));
  controller=new LauncherController(path.join(app.getPath('userData'),'config.json'),root,{system:{openExternal:url=>shell.openExternal(url),writeClipboard:text=>clipboard.writeText(text)}});
  await controller.initialize();
  protocol.handle('launcher-plugin',require('./plugin-protocol.cjs').createPluginProtocolHandler(controller));
  tray=new Tray(nativeImage.createEmpty());tray.setTitle('⌘');tray.setToolTip('Codex 启动器 · 未启动');
  panel=new BrowserWindow({width:420,height:660,show:false,frame:false,resizable:false,skipTaskbar:true,alwaysOnTop:true,backgroundColor:'#f6f7f9',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const ui=path.join(root,'launcher-ui/index.html');
  panel.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  panel.webContents.on('will-navigate',(event)=>event.preventDefault());
  panel.on('close',event=>{if(!quitting){event.preventDefault();panel.hide();}});
  panel.on('blur',()=>{if(!process.env.CODEX_LAUNCHER_KEEP_OPEN)panel.hide();});
  const handle=(name,fn)=>ipcMain.handle('launcher:'+name,async(event,...args)=>{
   if(event.sender!==panel.webContents||event.senderFrame!==panel.webContents.mainFrame)throw new Error('无效控制来源');
   return fn(...args);
  });
  handle('plugins:list',()=>controller.listPlugins());
  handle('plugins:enable',(id,value)=>controller.setPluginEnabled(id,value));
  handle('plugins:auto-start',(id,value)=>controller.setPluginAutoStart(id,value));
  handle('plugins:start',id=>controller.startPlugin(id));handle('plugins:stop',id=>controller.stopPlugin(id));
  handle('plugins:reload',()=>controller.reloadPlugins());
  handle('plugins:ui-url',id=>controller.pluginUiUrl(id));
  handle('plugins:invoke',(id,action,params)=>controller.invokePlugin(id,action,params));
  handle('plugins:open-folder',async()=>{const error=await shell.openPath(controller.pluginDirectory());if(error)throw new Error(error);});
  handle('status',()=>controller.status());handle('desktop:save',settings=>controller.saveDesktopSettings(settings));
  handle('desktop:restart',()=>controller.restartDesktop());handle('desktop:open',()=>controller.openDesktop());handle('desktop:connect',()=>controller.connectDesktop());
  controller.on('status',status=>{if(!panel.isDestroyed())panel.webContents.send('launcher:changed',status);tray.setToolTip('Codex 启动器 · '+(status.desktop.connected?'桌面已连接':'桌面未连接'));});
  tray.on('click',()=>panel.isVisible()?panel.hide():showPanel());
  tray.on('right-click',()=>tray.popUpContextMenu(Menu.buildFromTemplate([{label:'打开启动器',click:showPanel},{label:'打开 ChatGPT',click:()=>controller.openDesktop().catch(showError)},{type:'separator'},{label:'退出启动器',click:()=>app.quit()}])));
  await panel.loadFile(ui);resolveReady();await runCommand(process.argv);
 }).catch(error=>{rejectReady(error);showError(error);});
 app.on('window-all-closed',()=>{});
 app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;Promise.resolve(controller?.stop()).finally(()=>app.quit());});
}
function showPanel(){if(!panel||panel.isDestroyed())return;const b=tray.getBounds();const {screen}=require('electron');const area=screen.getDisplayMatching(b).workArea;panel.setPosition(Math.max(area.x,Math.min(b.x+b.width/2-210,area.x+area.width-420)),Math.max(area.y,b.y+b.height+5));panel.show();panel.focus();}
function showError(error){dialog.showErrorBox('Codex 启动器',String(error.message||error));}
