const {app}=require('electron');const {pathToFileURL}=require('node:url');
app.setPath('userData',process.env.CDP_FIXTURE_PROFILE);
app.whenReady().then(async()=>{try{const {ScriptPluginHost}=await import(pathToFileURL(process.env.PLUGIN_HOST_MODULE).href);const host=new ScriptPluginHost(process.env.PLUGIN_TEST_CONFIG,process.env.PLUGIN_TEST_PACKAGE);await host.initialize();console.log('PLUGIN_RESULT:'+JSON.stringify(host.list()));app.exit(0);}catch(error){console.error(error);app.exit(1);}});
