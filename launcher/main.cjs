const {app,Tray,Menu,BrowserWindow,nativeImage,ipcMain,clipboard,shell,dialog}=require('electron');
const path=require('node:path');
app.setName('Codex 启动器');
// 名称调整不迁移用户配置、插件和单实例锁目录。
app.setPath('userData',path.join(app.getPath('appData'),'codex-mobile'));
let tray,panel,controller,quitting=false;
const {createCommandHandler}=require('./commands.cjs');
let resolveReady,rejectReady;
const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
ready.catch(()=>{});
const openWeb=()=>{const url=controller.status().accessUrl;if(!url)throw new Error('请先启动连接');return shell.openExternal(url);};
const runCommand=createCommandHandler({ready,start:()=>controller.start(),openWeb,showPanel});
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',(_event,argv)=>{void runCommand(argv).catch(showError);});
 app.whenReady().then(async()=>{
  app.dock?.hide();
  const root=path.resolve(__dirname,'..');
  const {LauncherController}=await import(path.join(root,'npm-dist/server/launcher/controller.js'));
  controller=new LauncherController(path.join(app.getPath('userData'),'config.json'),root);
  await controller.initialize();
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
  handle('plugins:list',()=>controller.listPlugins());handle('plugins:enable',(id,enabled)=>controller.setPluginEnabled(id,enabled));handle('plugins:reload',()=>controller.reloadPlugins());handle('plugins:open-folder',async()=>{const error=await shell.openPath(controller.pluginDirectory());if(error)throw new Error(error);});
  handle('status',()=>controller.status());handle('save',c=>controller.save(c));
  handle('start',()=>controller.start());handle('stop',()=>controller.stop());
  handle('restart',()=>controller.restartDesktop());
  handle('open-desktop',()=>controller.openDesktop());
  handle('copy-url',()=>{const url=controller.status().accessUrl;if(!url)throw new Error('请先启动连接');clipboard.writeText(url);});
  handle('open-mobile',openWeb);
  handle('desktop-status',()=>controller.desktopStatus());handle('approve',(id,choice)=>controller.approve(id,choice));
  controller.on('status',status=>{if(!panel.isDestroyed())panel.webContents.send('launcher:changed',status);tray.setTitle(status.approvals?'⌘ '+status.approvals:'⌘');tray.setToolTip('Codex 启动器 · '+status.phase);});
  tray.on('click',()=>panel.isVisible()?panel.hide():showPanel());
  tray.on('right-click',()=>tray.popUpContextMenu(Menu.buildFromTemplate([{label:'打开启动器',click:showPanel},{label:controller.status().running?'打开 Web':'启动并打开 Web',click:()=>controller.start().then(openWeb).catch(showError)},{label:'打开 ChatGPT',click:()=>controller.openDesktop().catch(showError)},{type:'separator'},{label:'退出启动器',click:()=>app.quit()}])));
  await panel.loadFile(ui);resolveReady();await runCommand(process.argv);
 }).catch(error=>{rejectReady(error);showError(error);});
 app.on('window-all-closed',()=>{});
 app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;Promise.resolve(controller?.stop()).finally(()=>app.quit());});
}
function showPanel(){if(!panel||panel.isDestroyed())return;const b=tray.getBounds();const {screen}=require('electron');const area=screen.getDisplayMatching(b).workArea;panel.setPosition(Math.max(area.x,Math.min(b.x+b.width/2-210,area.x+area.width-420)),Math.max(area.y,b.y+b.height+5));panel.show();panel.focus();}
function showError(error){dialog.showErrorBox('Codex 启动器',String(error.message||error));}
