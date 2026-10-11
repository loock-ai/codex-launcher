// @vitest-environment node
import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {DesktopControlChannel} from '../../server/cdp/control-channel.js';
import {CdpControlTransport} from '../../server/cdp/control-transport.js';
import {createControlGateway} from '../../server/cdp/control-gateway.js';
it.skipIf(process.env.RUN_CDP_FIXTURE!=='1')('桌面UA常驻侧栏且对话可收发，窄窗口不切模式，手机宽屏仍为抽屉',async()=>{
 const profile=await mkdtemp(join(tmpdir(),'desktop-layout-fixture-'));
 const env:NodeJS.ProcessEnv={...process.env,CDP_FIXTURE_PORT:'19339',CDP_FIXTURE_PROFILE:profile,CDP_FIXTURE_PHONE_UA:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/155.0.0.0 Safari/537.36'};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[resolve('tests/fixtures/control-desktop.cjs')],{env,stdio:'ignore'});
 let browser:Awaited<ReturnType<typeof chromium.connectOverCDP>>|undefined,gateway:Awaited<ReturnType<typeof createControlGateway>>|undefined;
 try{
  for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:19339',{timeout:500});if(browser.contexts()[0].pages().some(p=>p.url()==='about:blank')&&browser.contexts()[0].pages().some(p=>p.url()==='app://-/index.html'))break;await browser.close();browser=undefined;}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!browser)throw Error('fixture unavailable');
  gateway=await createControlGateway({channel:new DesktopControlChannel(new CdpControlTransport('http://127.0.0.1:19339')),host:'127.0.0.1',port:0,token:'layout-fixture',staticDir:resolve('dist')});
  const page=browser.contexts()[0].pages().find(p=>p.url()==='about:blank')!;const url=`http://127.0.0.1:${gateway.port}/?token=layout-fixture`;page.setDefaultTimeout(8000);
  await page.setViewportSize({width:1440,height:900});await page.goto(url);await page.getByText('受控会话',{exact:true}).first().click();await page.getByText('历史输入',{exact:true}).waitFor();
  const sidebar=page.getByRole('complementary',{name:'会话列表'});expect(await sidebar.isVisible()).toBe(true);expect(await page.getByRole('button',{name:'关闭会话列表',exact:true}).count()).toBe(0);
  expect(await page.getByRole('button',{name:'打开会话列表',exact:true}).isVisible()).toBe(false);
  const sideBox=await sidebar.boundingBox(),composeBox=await page.locator('.composer-wrap').boundingBox();expect(sideBox!.width).toBe(300);expect(composeBox!.x).toBeGreaterThanOrEqual(sideBox!.x+sideBox!.width);expect(composeBox!.x+composeBox!.width).toBeLessThanOrEqual(1440);
  expect(await page.evaluate(()=>history.state?.codexMobileSidebar??false)).toBe(false);
  await sidebar.getByRole('button',{name:'Dots',exact:true}).click();await page.locator('.desktop-dots-panel').waitFor();expect(await sidebar.isVisible()).toBe(true);
  await sidebar.getByText('受控会话',{exact:true}).first().click();await page.locator('.desktop-dots-panel').waitFor({state:'hidden'});await page.getByText('历史输入',{exact:true}).waitFor();
  await page.getByRole('textbox',{name:'向 Codex 提问'}).fill('运行中问题测试');await page.getByRole('button',{name:'发送',exact:true}).click();await page.getByText('任务继续执行',{exact:true}).waitFor();
  await page.getByRole('textbox',{name:'向 Codex 提问'}).fill('桌面侧栏常驻引导');await page.getByRole('button',{name:'引导',exact:true}).click();await page.getByText('任务继续执行；已收到引导',{exact:true}).waitFor();expect(await sidebar.isVisible()).toBe(true);
  await page.screenshot({path:'/tmp/codex-web-desktop-sidebar.png'});
  await page.setViewportSize({width:700,height:700});expect(await sidebar.isVisible()).toBe(true);expect(await page.locator('.desktop-layout').count()).toBe(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const narrowComposer=await page.locator('.composer-wrap').boundingBox();expect(narrowComposer!.x).toBeGreaterThanOrEqual((await sidebar.boundingBox())!.width);await page.screenshot({path:'/tmp/codex-web-desktop-narrow.png'});
  await page.getByRole('button',{name:'停止',exact:true}).click();
  await page.addInitScript(()=>{Object.defineProperty(navigator,'userAgent',{get:()=> 'Mozilla/5.0 (iPhone; CPU iPhone OS 18) Mobile'});});
  await page.setViewportSize({width:1440,height:900});await page.reload();await page.getByText('受控会话',{exact:true}).first().click();await page.getByText('历史输入',{exact:true}).waitFor();expect(await page.locator('.mobile-layout').count()).toBe(1);expect(await sidebar.isVisible()).toBe(false);expect(await page.getByRole('button',{name:'打开会话列表',exact:true}).isVisible()).toBe(true);
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'打开会话列表',exact:true}).click();expect(await sidebar.isVisible()).toBe(true);await page.getByRole('button',{name:'关闭会话列表',exact:true}).click();await sidebar.waitFor({state:'hidden'});await page.screenshot({path:'/tmp/codex-web-mobile-drawer.png'});
 }finally{await gateway?.close();await browser?.close();child.kill('SIGTERM');await new Promise<void>(r=>{if(child.exitCode!==null)r();else child.once('exit',()=>r());});await rm(profile,{recursive:true,force:true});}
},30000);
