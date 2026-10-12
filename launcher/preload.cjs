const {contextBridge,ipcRenderer}=require('electron');
const invoke=(name,...args)=>ipcRenderer.invoke('launcher:'+name,...args);
contextBridge.exposeInMainWorld('launcher',{
 getStatus:()=>invoke('status'),saveDesktopSettings:settings=>invoke('desktop:save',settings),
 uninstallPlugin:id=>invoke('plugins:uninstall',id),
 listPluginRepositories:()=>invoke('repositories:list'),addPluginRepository:v=>invoke('repositories:add',v),editPluginRepository:(id,v)=>invoke('repositories:edit',id,v),setPluginRepositoryEnabled:(id,v)=>invoke('repositories:enable',id,v),removePluginRepository:id=>invoke('repositories:remove',id),
 checkPluginUpdates:()=>invoke('plugins:check-updates'),updatePlugin:(id,options)=>invoke('plugins:update',id,options),
 listPlugins:()=>invoke('plugins:list'),setPluginEnabled:(id,value)=>invoke('plugins:enable',id,value),setPluginAutoStart:(id,value)=>invoke('plugins:auto-start',id,value),startPlugin:id=>invoke('plugins:start',id),stopPlugin:id=>invoke('plugins:stop',id),reloadPlugins:()=>invoke('plugins:reload'),openPluginsFolder:()=>invoke('plugins:open-folder'),pluginUiUrl:id=>invoke('plugins:ui-url',id),invokePlugin:(id,action,params)=>invoke('plugins:invoke',id,action,params),
 restart:()=>invoke('desktop:restart'),openDesktop:()=>invoke('desktop:open'),connectDesktop:()=>invoke('desktop:connect'),
 subscribe:callback=>{const fn=(_event,status)=>callback(status);ipcRenderer.on('launcher:changed',fn);return()=>ipcRenderer.removeListener('launcher:changed',fn)},
});
