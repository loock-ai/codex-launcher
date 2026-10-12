const {app,BrowserWindow,protocol}=require('electron');
const path=require('node:path');
app.setPath('userData',process.env.CDP_FIXTURE_PROFILE);
app.commandLine.appendSwitch('remote-debugging-port',process.env.CDP_FIXTURE_PORT);
protocol.registerSchemesAsPrivileged([{scheme:'launcher-plugin',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
app.whenReady().then(()=>{protocol.handle('launcher-plugin',require('../../launcher/plugin-protocol.cjs').createPluginProtocolHandler({resolvePluginUiAsset:async(id,asset)=>{if(!['fixture','mobile'].includes(id)||!['ui/index.html','ui/main.js','ui/app.js','ui/style.css'].includes(asset))throw Error('invalid');return path.join(process.env.PLUGIN_UI_FIXTURE,asset)}}));const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});win.loadURL('about:blank')});
