const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('launcher',{
 listPlugins:()=>ipcRenderer.invoke('launcher:plugins:list'),setPluginEnabled:(id,enabled)=>ipcRenderer.invoke('launcher:plugins:enable',id,enabled),reloadPlugins:()=>ipcRenderer.invoke('launcher:plugins:reload'),openPluginsFolder:()=>ipcRenderer.invoke('launcher:plugins:open-folder'),
 getStatus:()=>ipcRenderer.invoke('launcher:status'),
 saveConfig:config=>ipcRenderer.invoke('launcher:save',config),
 start:()=>ipcRenderer.invoke('launcher:start'),stop:()=>ipcRenderer.invoke('launcher:stop'),
 restart:()=>ipcRenderer.invoke('launcher:restart'),openDesktop:()=>ipcRenderer.invoke('launcher:open-desktop'),
 copyUrl:()=>ipcRenderer.invoke('launcher:copy-url'),openMobile:()=>ipcRenderer.invoke('launcher:open-mobile'),
 desktopStatus:()=>ipcRenderer.invoke('launcher:desktop-status'),approve:(id,choice)=>ipcRenderer.invoke('launcher:approve',id,choice),
 subscribe:callback=>{const fn=(_event,status)=>callback(status);ipcRenderer.on('launcher:changed',fn);return()=>ipcRenderer.removeListener('launcher:changed',fn);},
});
