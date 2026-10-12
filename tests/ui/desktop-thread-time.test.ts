import { readFileSync, existsSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
const path = 'plugins/desktop-thread-time/inject.js';
const disposers: Array<() => void> = [];
const now = 1791777600;
function row(id: string, host = '', kind = 'local') {
  const el = document.createElement('div');
  el.setAttribute('data-app-action-sidebar-thread-row', '');
  el.setAttribute('data-app-action-sidebar-thread-id', id);
  el.setAttribute('data-app-action-sidebar-thread-host-id', host);
  el.setAttribute('data-app-action-sidebar-thread-kind', kind);
  el.innerHTML = '<div style="display:flex;align-items:center"><span data-thread-title-trigger style="min-width:0;flex:1">会话标题</span><button>菜单</button></div>';
  document.body.append(el);
  return el;
}
async function start(manager: any, version = '26.1007.30912', openFactory?: (manager: any) => any, servicesFactory?: () => any) {
  expect(existsSync(path), '应提供独立的时间插件').toBe(true);
  const controller = new AbortController();
  const opened: string[] = [];
  (globalThis as any).__timeServices = { appServerManagers: { open: (host: string) => { opened.push(host); return openFactory ? openFactory(manager) : Promise.resolve({ status: 'ready', manager }); } } };
  (window as any).electronBridge = { getSentryInitOptions: () => ({ appVersion: version }) };
  const source = readFileSync(path, 'utf8').replace('await import(moduleUrl)', 'await loadNative(moduleUrl)');
  const run = new Function('context', 'loadNative', `return (async () => {${source}\n})()`);
  await run({ signal: controller.signal, onDispose: (fn: () => void) => disposers.push(fn) }, async () => ({ get fN(){return servicesFactory?servicesFactory():(globalThis as any).__timeServices}, get aj(){return servicesFactory?servicesFactory():(globalThis as any).__timeServices} }));
  return { controller, opened };
}
afterEach(() => { disposers.splice(0).forEach(fn => fn()); document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks(); });
test('读取原生 local key 和远端 host 缓存，保留标题菜单，缺失时间与非 Codex 行不显示', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
  const a = row('local:a', 'remote-ssh:mac');
  const b = row('local:b'); row('remote:c', '', 'remote'); row('chatgpt:conversation:d', '', 'chatgpt');
  const { opened } = await start({ getCachedThreadMetadata: async (ids: string[]) => { expect(Array.isArray(ids)).toBe(true); return ids.includes('a') ? [{ id: 'a', updatedAt: now - 120 }] : []; } });
  expect(a.querySelector('[data-codex-mobile-time]')?.textContent).toBe('2 分钟');
  expect(a.querySelector('[data-codex-mobile-time]')?.getAttribute('title')).toBeTruthy();
  expect(a.querySelector('button')?.textContent).toBe('菜单');
  expect(b.querySelector('[data-codex-mobile-time]')).toBeNull();
  expect(document.querySelectorAll('[data-codex-mobile-time]')).toHaveLength(1);
  expect(opened).toEqual(['remote-ssh:mac', 'local']);
});
test('虚拟列表复用行时替换时间，关闭后清除标签样式并释放代理', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
  const a = row('local:a'); let disposed = false;
  await start({ [Symbol.dispose]: () => { disposed = true; }, getCachedThreadMetadata: async (ids: string[]) => ids.map(id => ({ id, updatedAt: now - (id === 'a' ? 10 : 7200) })) });
  expect(a.textContent).toContain('刚刚');
  a.setAttribute('data-app-action-sidebar-thread-id', 'local:b');
  await vi.waitFor(() => expect(a.textContent).toContain('2 小时'));
  disposers.splice(0).forEach(fn => fn());
  expect(a.querySelector('[data-codex-mobile-time]')).toBeNull();
  expect(document.querySelector('[data-codex-mobile-time-style]')).toBeNull();
  expect(disposed).toBe(true);
});
test('未知版本清晰失败且不访问管理器', async () => {
  await expect(start({}, '99.0')).rejects.toThrow('未适配');
});
test('取消后晚到的缓存结果不得添加标签', async () => {
  row('local:a'); let finish!: (v: any) => void;
  const pending = start({ getCachedThreadMetadata: () => new Promise(resolve => { finish = resolve; }) });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  disposers.splice(0).forEach(fn => fn());
  finish([{ id: 'a', updatedAt: now }]); await pending;
  expect(document.querySelector('[data-codex-mobile-time]')).toBeNull();
});
test('每30秒重新读取已显示会话，并更新分钟与天标签', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now * 1000);
  const a = row('local:a'); let updatedAt = now - 50;
  await start({ getCachedThreadMetadata: async () => [{ id: 'a', updatedAt }] }, '26.1002.52244');
  expect(a.textContent).toContain('刚刚');
  updatedAt = now - 86400;
  await vi.advanceTimersByTimeAsync(30100);
  expect(a.textContent).toContain('1 天');
});
test('取消进行中的读取，代理仅释放一次', async () => {
  row('local:a'); let finish!: (v: any) => void; let released = 0;
  const pending = start({ [Symbol.dispose]: () => { released++; }, getCachedThreadMetadata: () => new Promise(resolve => { finish = resolve; }) });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  disposers.splice(0).forEach(fn => fn());
  finish([]); await pending;
  expect(released).toBe(1);
});
test('限额只读取前200行和8个主机，不扫描历史', async () => {
  for (let i = 0; i < 250; i++) row(`local:${i}`, `host-${i % 10}`);
  const requested: string[] = [];
  const { opened } = await start({ getCachedThreadMetadata: async (ids: string[]) => { requested.push(...ids); return []; } });
  expect(opened).toHaveLength(8);
  expect(requested.length).toBeLessThanOrEqual(200);
  expect(requested.every(id => Number(id) < 200)).toBe(true);
});
test('复用为非Codex行立即移除旧时间，原始属性与style不变', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
  const a = row('local:a'); a.style.color = 'red'; a.setAttribute('title', '原生提示');
  await start({ getCachedThreadMetadata: async () => [{ id: 'a', updatedAt: now }] });
  a.setAttribute('data-app-action-sidebar-thread-kind', 'chatgpt');
  await vi.waitFor(() => expect(a.querySelector('[data-codex-mobile-time]')).toBeNull());
  expect(a.getAttribute('title')).toBe('原生提示'); expect(a.style.color).toBe('red');
});
test('时间标签可悬停查看完整日期，点击仍冒泡到会话行', async () => {
  const a = row('local:a'); let clicked = false;
  a.addEventListener('click', () => { clicked = true; });
  await start({ getCachedThreadMetadata: async () => [{ id: 'a', updatedAt: now }] });
  const label = a.querySelector<HTMLElement>('[data-codex-mobile-time]')!;
  expect(getComputedStyle(label).pointerEvents).not.toBe('none');
  expect(label.title).toBe(new Date(now * 1000).toLocaleString());
  label.click(); expect(clicked).toBe(true);
});
test('请求完成后释放open和metadata的pending句柄', async () => {
  row('local:a'); let openReleased = false; let readReleased = false;
  await start({ getCachedThreadMetadata: () => Object.assign(Promise.resolve([{ id: 'a', updatedAt: now }]), { [Symbol.dispose]: () => { readReleased = true; } }) }, undefined,
    manager => Object.assign(Promise.resolve({ status: 'ready', manager }), { [Symbol.dispose]: () => { openReleased = true; } }));
  expect(openReleased).toBe(true); expect(readReleased).toBe(true);
});
test('取消时立即释放pending open，晚到manager仍释放', async () => {
  row('local:a'); let finish!: (v: any) => void; let openReleased = 0; let managerReleased = 0;
  const manager = { [Symbol.dispose]: () => { managerReleased++; } };
  const pending = start(manager, undefined, () => Object.assign(new Promise(resolve => { finish = resolve; }), { [Symbol.dispose]: () => { openReleased++; } }));
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  disposers.splice(0).forEach(fn => fn());
  expect(openReleased).toBe(1);
  finish({ status: 'ready', manager }); await pending;
  expect(openReleased).toBe(1); expect(managerReleased).toBe(1);
  expect(document.querySelector('[data-codex-mobile-time]')).toBeNull();
});
test('取消缓存读取立即释放pending句柄，晚到结果仅释放不渲染', async () => {
  row('local:a'); let finish!: (v: any) => void; let requestReleased = 0; let resultReleased = 0;
  const pending = start({ getCachedThreadMetadata: () => Object.assign(new Promise(resolve => { finish = resolve; }), { [Symbol.dispose]: () => { requestReleased++; } }) });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  disposers.splice(0).forEach(fn => fn());
  expect(requestReleased).toBe(1);
  finish(Object.assign([{ id: 'a', updatedAt: now }], { [Symbol.dispose]: () => { resultReleased++; } })); await pending;
  expect(requestReleased).toBe(1); expect(resultReleased).toBe(1);
  expect(document.querySelector('[data-codex-mobile-time]')).toBeNull();
});
test('正文DOM更新不触发读取，新增与替换侧栏行仍更新时间', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now * 1000);
  const a = row('local:a'); let reads = 0;
  await start({ getCachedThreadMetadata: async (ids: string[]) => { reads++; return ids.map(id => ({ id, updatedAt: now - (id === 'a' ? 60 : 7200) })); } });
  const baseline = reads;
  const article = document.createElement('article'); article.innerHTML = '<div>流式正文</div>'; document.body.append(article);
  article.append(document.createElement('p'));
  await vi.advanceTimersByTimeAsync(150);
  expect(reads).toBe(baseline);
  const b = row('local:b');
  await vi.advanceTimersByTimeAsync(150);
  expect(b.textContent).toContain('2 小时');
  const replacement = row('local:c'); a.replaceWith(replacement);
  await vi.advanceTimersByTimeAsync(150);
  expect(replacement.textContent).toContain('2 小时');
});
test('主机变为不可用时移除已有时间', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now * 1000);
  const a = row('local:a'); let ready = true;
  await start({ getCachedThreadMetadata: async () => [{ id: 'a', updatedAt: now }] }, undefined,
    manager => Promise.resolve(ready ? { status: 'ready', manager } : { status: 'unavailable' }));
  expect(a.querySelector('[data-codex-mobile-time]')).not.toBeNull();
  ready = false;
  await vi.advanceTimersByTimeAsync(30100);
  expect(a.querySelector('[data-codex-mobile-time]')).toBeNull();
});
test('没有appServerManagers时读取原生目录，每批100条且校验主机和会话身份',async()=>{
 vi.spyOn(Date,'now').mockReturnValue(now*1000);for(let i=0;i<120;i++)row('local:'+i,'ssh:mac');
 const sizes:number[]=[];
 await start({},undefined,undefined,()=>({localThreadCatalog:{readEntries:async(refs:any[])=>{sizes.push(refs.length);return [...refs.map(r=>({...r,sourceUpdatedAt:now-120})),{hostId:'wrong',threadId:'0',sourceUpdatedAt:now}];}}}));
 expect(sizes).toEqual([100,20]);expect(document.querySelectorAll('[data-codex-mobile-time]')).toHaveLength(120);expect(document.querySelector('[data-codex-mobile-time]')?.textContent).toBe('2 分钟');
});
test('主机管理器不可用时回退到会话目录',async()=>{
 vi.spyOn(Date,'now').mockReturnValue(now*1000);row('local:a');
 await start({},undefined,undefined,()=>({appServerManagers:{open:async()=>({status:'unavailable'})},localThreadCatalog:{readEntries:async()=>[{hostId:'local',threadId:'a',sourceUpdatedAt:now-3600}]}}));
 expect(document.querySelector('[data-codex-mobile-time]')?.textContent).toBe('1 小时');
});
test('等待已存在AppHost初始化后读取目录，不重新注册宿主',async()=>{
 vi.useFakeTimers();vi.setSystemTime(now*1000);row('local:a');let available=false;
 const promise=start({},undefined,undefined,()=>available?{localThreadCatalog:{readEntries:async()=>[{hostId:'local',threadId:'a',sourceUpdatedAt:now}]}}:undefined);
 await vi.advanceTimersByTimeAsync(150);available=true;await vi.advanceTimersByTimeAsync(150);await promise;
 expect(document.querySelector('[data-codex-mobile-time]')?.textContent).toBe('刚刚');
});

test('时间进入原生标题所在行，保持在状态菜单前，不追加到块级行末尾',async()=>{
 const a=row('local:a');await start({getCachedThreadMetadata:async()=>[{id:'a',updatedAt:now}]});
 const title=a.querySelector('[data-thread-title-trigger]')!;const label=a.querySelector('[data-codex-mobile-time]')!;
 expect(label.parentElement).toBe(title.parentElement);expect(title.nextElementSibling).toBe(label);expect(label.nextElementSibling?.tagName).toBe('BUTTON');
});

 test('优先级摘要行把时间放在标题横排内，避免挤占整列或进入操作按钮区域',async()=>{
 const a=row('local:priority');
 a.innerHTML='<div style="display:flex;align-items:center"><div data-thread-title-trigger style="display:flex;flex-direction:column;flex:1;min-width:0"><div style="display:flex;align-items:center;min-width:0"><span style="display:flex;flex:1;min-width:0"><span data-thread-title>很长的会话标题</span><span>项目名称</span></span><button>状态</button></div><div>两行会话摘要</div></div></div><button style="position:absolute;right:8px;top:8px">置顶</button>';
 await start({getCachedThreadMetadata:async()=>[{id:'priority',updatedAt:now}]});
 const title=a.querySelector('[data-thread-title]')!;const label=a.querySelector('[data-codex-mobile-time]')!;
 expect(label.parentElement).toBe(title.parentElement!.parentElement);
 expect(label.previousElementSibling).toBe(title.parentElement);
 expect(label.nextElementSibling?.textContent).toBe('状态');
 disposers.splice(0).forEach(fn=>fn());expect(a.querySelector('[data-codex-mobile-time]')).toBeNull();
 });
