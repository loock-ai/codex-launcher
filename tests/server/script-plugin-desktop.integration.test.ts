// @vitest-environment node
import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright-core';
import {ScriptPluginHost} from '../../server/launcher/script-plugins.js';
it.skipIf(process.env.RUN_CDP_FIXTURE!=='1')('从配置目录注入时间插件，重载页面与脚本后生效，关闭移除且不覆盖用户代码',async()=>{
 const profile=await mkdtemp(join(tmpdir(),'plugin-desktop-')),config=await mkdtemp(join(tmpdir(),'plugin-settings-'));
 const env:NodeJS.ProcessEnv={...process.env,CDP_FIXTURE_PORT:'19340',CDP_FIXTURE_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[resolve('tests/fixtures/plugin-desktop.cjs')],{env,stdio:'ignore'});
 let browser:Awaited<ReturnType<typeof chromium.connectOverCDP>>|undefined;const host=new ScriptPluginHost(join(config,'config.json'),resolve('.'));
 try{
  for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:19340',{timeout:500});if(browser.contexts()[0].pages().some(p=>p.url()==='app://-/index.html'))break;await browser.close();browser=undefined;}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!browser)throw Error('fixture unavailable');const page=browser.contexts()[0].pages().find(p=>p.url()==='app://-/index.html')!;page.setDefaultTimeout(8000);await page.setViewportSize({width:520,height:360});
  const priority=page.locator('[data-app-action-sidebar-thread-id="local:priority-a"]');const initialHeight=(await priority.boundingBox())!.height;
  await host.initialize();expect(host.list().plugins.find(p=>p.id==='desktop-thread-time')?.enabled).toBe(true);
  expect(await page.locator('[data-app-action-sidebar-thread-id="local:thread-a"] [data-codex-mobile-time]').count()).toBe(0);
  await host.bind('http://127.0.0.1:19340');await page.locator('[data-app-action-sidebar-thread-id="local:thread-a"] [data-codex-mobile-time]').waitFor();expect(await page.locator('[data-app-action-sidebar-thread-id="local:thread-a"] [data-codex-mobile-time]').textContent()).toContain('2 分钟');expect(await page.locator('[data-app-action-sidebar-thread-id="local:thread-a"] [data-codex-mobile-time]').getAttribute('title')).toBeTruthy();
  await page.reload();await page.locator('[data-app-action-sidebar-thread-id="local:thread-a"] [data-codex-mobile-time]').waitFor();expect(await page.locator('[data-app-action-sidebar-thread-id="local:thread-a"] [data-codex-mobile-time]').count()).toBe(1);
  const entry=join(config,'plugins/desktop-thread-time/inject.js');const original=await readFile(entry,'utf8');await writeFile(entry,original+'\nwindow.__editedPluginFixture=true;\n');await host.reload();expect(await page.evaluate(()=>(window as any).__editedPluginFixture)).toBe(true);
  const titleBox=await page.locator('[data-app-action-sidebar-thread-id="local:thread-a"] [data-thread-title-trigger]').boundingBox(),timeBox=await page.locator('[data-app-action-sidebar-thread-id="local:thread-a"] [data-codex-mobile-time]').boundingBox(),menuBox=await page.getByRole('button',{name:'原生菜单'}).boundingBox();
  expect(Math.abs((titleBox!.y+titleBox!.height/2)-(timeBox!.y+timeBox!.height/2))).toBeLessThan(2);
  expect(timeBox!.x).toBeGreaterThanOrEqual(titleBox!.x+titleBox!.width);expect(timeBox!.x+timeBox!.width).toBeLessThanOrEqual(menuBox!.x);
  expect((await page.locator('[data-app-action-sidebar-thread-id="local:thread-a"]').boundingBox())!.height).toBe(40);
  for(const width of [240,300,380]) {
   await page.locator('aside').evaluate((el,width)=>{el.style.width=width+'px'},width);
   for(const mode of ['rest','hover','selected']) {
    await priority.evaluate((el,mode)=>{el.setAttribute('data-app-action-sidebar-thread-selected',String(mode==='selected'))},mode);
    if(mode==='hover')await priority.hover();else await page.mouse.move(500,0);
    const title=await priority.locator('.priority-title-group').boundingBox(),time=await priority.locator('[data-codex-mobile-time]').boundingBox(),summary=await priority.locator('.priority-summary').boundingBox();
    expect(Math.abs((title!.y+title!.height/2)-(time!.y+time!.height/2))).toBeLessThan(2);
    expect(time!.x).toBeGreaterThanOrEqual(title!.x+title!.width);expect(time!.y+time!.height).toBeLessThanOrEqual(summary!.y);
    if(mode!=='rest'){const pin=await page.getByRole('button',{name:'置顶',exact:true}).boundingBox();expect(time!.x+time!.width).toBeLessThanOrEqual(pin!.x);}
    expect((await priority.boundingBox())!.height).toBe(initialHeight);
   }
  }
  await page.screenshot({path:'/tmp/codex-desktop-thread-time-plugin.png'});
  await host.setEnabled('desktop-thread-time',false);await page.locator('[data-app-action-sidebar-thread-id="local:thread-a"] [data-codex-mobile-time]').waitFor({state:'detached'});
  const again=new ScriptPluginHost(join(config,'config.json'),resolve('.'));await again.initialize();expect(await readFile(entry,'utf8')).toContain('__editedPluginFixture');expect(again.list().plugins.find(p=>p.id==='desktop-thread-time')?.enabled).toBe(false);await again.bind(null);
 }finally{await host.bind(null);await browser?.close();child.kill('SIGTERM');await new Promise<void>(r=>{if(child.exitCode!==null)r();else child.once('exit',()=>r());});await rm(profile,{recursive:true,force:true});await rm(config,{recursive:true,force:true});}
},30000);
