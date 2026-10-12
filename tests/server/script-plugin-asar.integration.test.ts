// @vitest-environment node
import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createPackage} from '@electron/asar';
it.skipIf(process.env.RUN_CDP_FIXTURE!=='1')('Electron从真实ASAR初始化插件模板，不依赖fs.cp且不覆盖用户文件',async()=>{
 const root=await mkdtemp(join(tmpdir(),'plugin-asar-test-'));try{
 const source=join(root,'source'),template=join(source,'plugins/example'),archive=join(root,'app.asar'),config=join(root,'user/config.json');await mkdir(template,{recursive:true});
 await writeFile(join(template,'manifest.json'),JSON.stringify({id:'example',name:'ASAR插件',version:'1',entry:'inject.js'}));await writeFile(join(template,'inject.js'),'context.onDispose(()=>{});');await createPackage(source,archive);
 const run=async()=>{const env:NodeJS.ProcessEnv={...process.env,CDP_FIXTURE_PROFILE:join(root,'electron'),PLUGIN_HOST_MODULE:resolve('npm-dist/server/launcher/script-plugins.js'),PLUGIN_TEST_PACKAGE:archive,PLUGIN_TEST_CONFIG:config};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[resolve('tests/fixtures/plugin-asar.cjs')],{env});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});expect(code,output).toBe(0);return JSON.parse(output.split('\n').find(line=>line.startsWith('PLUGIN_RESULT:'))!.slice(14));};
 const state=await run();expect(state.plugins).toMatchObject([{id:'example',enabled:false,state:'inactive'}]);const copied=join(root,'user/plugins/example/inject.js');expect(await readFile(copied,'utf8')).toBe('context.onDispose(()=>{});');await writeFile(copied,'user edited');await run();expect(await readFile(copied,'utf8')).toBe('user edited');
 }finally{await rm(root,{recursive:true,force:true});}
},15000);
