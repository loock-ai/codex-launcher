// @vitest-environment node
import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {defaultConfig} from '../../server/launcher/config.js';
it.skipIf(process.env.RUN_CDP_FIXTURE!=='1')('启动器实际构建默认隐藏二维码，点击展开收起，重启直接调用接口',async()=>{
 const profile=await mkdtemp(join(tmpdir(),'launcher-panel-fixture-'));
 const env:NodeJS.ProcessEnv={...process.env,CDP_FIXTURE_PORT:'19338',CDP_FIXTURE_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[resolve('tests/fixtures/control-desktop.cjs')],{env,stdio:'ignore'});
 let browser:Awaited<ReturnType<typeof chromium.connectOverCDP>>|undefined;
 try{
  for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:19338',{timeout:500});if(browser.contexts()[0].pages().some(p=>p.url()==='about:blank'))break;await browser.close();browser=undefined;}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!browser)throw Error('fixture unavailable');const page=browser.contexts()[0].pages().find(p=>p.url()==='about:blank')!;
  await page.setViewportSize({width:420,height:660});
  await page.route('http://launcher.fixture/**',async route=>{const path=new URL(route.request().url()).pathname;await route.fulfill({status:200,body:await readFile(resolve('launcher-ui',path==='/'?'index.html':path.slice(1))),contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'});});
  await page.addInitScript(config=>{const state={config,running:true,phase:'已启动',error:'',clients:1,approvals:0,thread:'',accessUrl:'http://127.0.0.1:19877/?token=fixture-only',logs:[]};(window as any).restarts=0;const plugins={directory:'/fixture/config/plugins',plugins:[{id:'desktop-thread-time',name:'会话时间',description:'在桌面会话列表显示最近更新时间',version:'1.0.0',enabled:false,state:'inactive',path:'/fixture/config/plugins/desktop-thread-time'}]};(window as any).launcher={getStatus:async()=>state,subscribe:()=>()=>{},listPlugins:async()=>plugins,setPluginEnabled:async(_id:string,enabled:boolean)=>{plugins.plugins[0].enabled=enabled;plugins.plugins[0].state=enabled?'active':'inactive';return plugins;},reloadPlugins:async()=>plugins,openPluginsFolder:async()=>{},restart:async()=>{(window as any).restarts++;return state;}};},defaultConfig());
  let dialogs=0;page.on('dialog',async dialog=>{dialogs++;await dialog.dismiss();});await page.goto('http://launcher.fixture/');
  await page.getByRole('button',{name:'展开二维码',exact:true}).waitFor();expect(await page.getByRole('img',{name:'手机连接二维码'}).count()).toBe(0);
  await page.screenshot({path:'/tmp/codex-launcher-qr-collapsed.png'});
  await page.getByRole('button',{name:'展开二维码',exact:true}).click();await page.getByRole('img',{name:'手机连接二维码'}).waitFor();
  await page.getByRole('button',{name:'收起二维码',exact:true}).click();expect(await page.getByRole('img',{name:'手机连接二维码'}).count()).toBe(0);
  await page.getByRole('button',{name:'强制重启 ChatGPT',exact:true}).click();expect(await page.evaluate(()=>(window as any).restarts)).toBe(1);expect(dialogs).toBe(0);
  await page.getByRole('button',{name:'插件',exact:true}).click();await page.getByRole('checkbox',{name:'启用 会话时间'}).check();await page.getByText('已注入',{exact:true}).waitFor();await page.screenshot({path:'/tmp/codex-launcher-script-plugins.png'});await page.getByRole('checkbox',{name:'启用 会话时间'}).uncheck();await page.getByText('未启用',{exact:true}).waitFor();
 }finally{await browser?.close();child.kill('SIGTERM');await new Promise<void>(r=>{if(child.exitCode!==null)r();else child.once('exit',()=>r());});await rm(profile,{recursive:true,force:true});}
},20000);
