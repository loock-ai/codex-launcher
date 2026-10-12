// 本文件是由启动器调用的 async function body，仅读取已加载会话的缓存。
const rowSelector = '[data-app-action-sidebar-thread-row]';
const marker = 'data-codex-mobile-time';
const prefix = 'data-app-action-sidebar-thread-';
const maxRows = 200;
const maxHosts = 8;
let stopped = false;
let observer;
let interval;
let scheduled;
let busy = false;
let dirty = false;
const labels = new Set();
const proxies = new Set();
const cache = new Map();
let style;
function release(value) {
  try { value?.[Symbol.dispose]?.(); } catch { /* 已失效的远端代理仍须允许关闭。 */ }
}
function cleanup() {
  if (stopped) return;
  stopped = true;
  observer?.disconnect();
  clearInterval(interval);
  clearTimeout(scheduled);
  for (const label of labels) label.remove();
  labels.clear();
  style?.remove();
  for (const proxy of proxies) release(proxy);
  proxies.clear();
  cache.clear();
  context.signal.removeEventListener('abort', cleanup);
}
// 首次 await 之前注册，宿主超时或关闭后禁止任何晚到结果写入 DOM。
context.onDispose(cleanup);
context.signal.addEventListener('abort', cleanup, { once: true });
if (context.signal.aborted) { cleanup(); return; }
const version = window.electronBridge?.getSentryInitOptions?.()?.appVersion;
const adapters = {
  '26.1007.30912': ['app-shared-8bd9d0399038.js', 'fN'],
  '26.1002.52244': ['app-shared-6c00c2afcf84.js', 'aj'],
};
const adapter = adapters[version];
if (!adapter) throw new Error(`会话时间插件未适配桌面版本：${version ?? '未知'}`);
const moduleUrl = new URL(`./assets/${adapter[0]}`, location.href).href;
const native = await import(moduleUrl);
if (stopped) return;
let services;
// appServerManagers 受桌面功能开关控制；目录服务独立存在。
for (let attempt = 0; attempt < 40 && !stopped; attempt++) {
  services = native[adapter[1]];
  if (typeof services?.localThreadCatalog?.readEntries === 'function' || typeof services?.appServerManagers?.open === 'function') break;
  await new Promise(resolve => {
    const done = () => { clearTimeout(timer); context.signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, 100);
    context.signal.addEventListener('abort', done, { once: true });
    if (context.signal.aborted) done();
  });
}
if (stopped) return;
if (typeof services?.localThreadCatalog?.readEntries !== 'function' && typeof services?.appServerManagers?.open !== 'function') throw new Error('会话时间插件：桌面未提供会话目录或缓存管理器，请待桌面加载完成后重新加载插件');
style = document.createElement('style');
style.setAttribute('data-codex-mobile-time-style', '');
style.textContent = `[${marker}] { display: inline-block; flex: 0 0 auto; align-self: center; margin-inline: 4px; font-size: 10px; font-weight: 400; font-variant-numeric: tabular-nums; line-height: 14px; opacity: .55; white-space: nowrap; user-select: none; }`;
document.head.append(style);
function identity(row) {
  // 原生 local 包含 SSH 主机；remote 是云任务。ChatGPT 与待创建任务不读取。
  if (row.getAttribute(prefix + 'kind') !== 'local') return null;
  const key = row.getAttribute(prefix + 'id') ?? '';
  if (!key.startsWith('local:')) return null;
  const id = key.slice(6);
  if (!id || id.startsWith('client-new-thread:')) return null;
  const host = row.getAttribute(prefix + 'host-id') || 'local';
  return { id, host, key: JSON.stringify([host, id]) };
}
function timestamp(value) {
  // 原生时间是 Unix 秒。缺失时间不以创建时间或当前时间替代。
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e11 ? value : null;
}
function render(rows) {
  const active = new Set(rows);
  for (const label of labels) {
    if (!active.has(label.closest(rowSelector))) { label.remove(); labels.delete(label); }
  }
  for (const row of rows) {
    const item = identity(row);
    const time = item ? cache.get(item.key) : null;
    // 单行模式的 trigger 是标题横排；优先级模式则是标题和摘要的纵向容器。
    const titleNode = row.querySelector('[data-thread-title-trigger]');
    let anchor = titleNode;
    if (titleNode && getComputedStyle(titleNode).flexDirection === 'column') {
      const title = titleNode.querySelector('[data-thread-title]');
      // 找到纵向容器的标题行，再定位其中包含标题和项目名的整体。
      let header = title;
      while (header && header.parentElement !== titleNode) header = header.parentElement;
      anchor = title;
      while (anchor && anchor.parentElement !== header) anchor = anchor.parentElement;
      if (!header || anchor === header) anchor = null;
    }
    const titleParent = anchor?.parentElement;
    let label = [...row.querySelectorAll(`[${marker}]`)].find(child => labels.has(child) && child.closest(rowSelector) === row);
    if (!time || !titleParent || titleNode.closest(rowSelector) !== row) { if (label) { label.remove(); labels.delete(label); } continue; }
    if (!label) { label = document.createElement('span'); label.setAttribute(marker, ''); labels.add(label); }
    if (anchor.nextElementSibling !== label) anchor.after(label);
    const elapsed = Math.max(0, Math.floor(Date.now() / 1000 - time));
    const days = Math.floor(elapsed / 86400);
    const hours = Math.floor(elapsed / 3600) % 24;
    const minutes = Math.floor(elapsed / 60) % 60;
    const text = elapsed < 60 ? '刚刚' : days ? `${days}d` : `${hours ? `${hours}h` : ''}${minutes ? `${hours ? String(minutes).padStart(2, '0') : minutes}m` : ''}`;
    if (label.textContent !== text) label.textContent = text;
    const title = new Date(time * 1000).toLocaleString();
    if (label.title !== title) label.title = title;
  }
}
async function refresh() {
  if (stopped) return;
  if (busy) { dirty = true; return; }
  busy = true;
  const rows = Array.from(document.querySelectorAll(rowSelector)).slice(0, maxRows);
  render(rows);
  const groups = new Map();
  const wanted = new Set();
  for (const row of rows) {
    const item = identity(row);
    if (!item) continue;
    if (!groups.has(item.host)) {
      if (groups.size >= maxHosts) continue;
      groups.set(item.host, new Map());
    }
    groups.get(item.host).set(item.id, item.key);
    wanted.add(item.key);
  }
  for (const key of cache.keys()) if (!wanted.has(key)) cache.delete(key);
  try {
    for (const [host, items] of groups) {
      if (stopped) break;
      let opened;
      let manager;
      let metadata;
      const resources = new Set();
      function track(value) {
        if (value && !resources.has(value)) {
          resources.add(value);
          proxies.add(value);
        }
        return value;
      }
      try {
        if (typeof services.localThreadCatalog?.readEntries === 'function') {
          metadata = [];
          const ids = [...items.keys()];
          // 原生目录读取每批最多100条；仅读取，不启用源、不触发同步。
          for (let index = 0; index < ids.length && !stopped; index += 100) {
            const request = track(services.localThreadCatalog.readEntries(ids.slice(index, index + 100).map(threadId => ({ hostId: host, threadId }))));
            const entries = track(await request);
            if (stopped) break;
            if (Array.isArray(entries)) for (const entry of entries) {
              if (entry.hostId === host && items.has(entry.threadId)) metadata.push({ id: entry.threadId, recencyAt: entry.sourceRecencyAt, updatedAt: entry.sourceUpdatedAt });
            }
          }
        } else {
        // 请求本身也可能是带 dispose 的 thenable，不能只保留 await 的结果。
        const opening = track(services.appServerManagers.open(host));
        opened = track(await opening);
        manager = track(opened?.manager);
        if (stopped) continue;
        if (opened?.status !== 'ready' || !manager) throw new Error('主机缓存暂不可用');
        const reading = track(manager.getCachedThreadMetadata([...items.keys()]));
        metadata = track(await reading);
        }
        if (stopped) continue;
        for (const key of items.values()) cache.delete(key);
        if (Array.isArray(metadata)) {
          for (const entry of metadata) {
            const key = items.get(entry.id);
            // updatedAt 也会因元数据同步变化；优先显示真实会话活动时间。
            const time = timestamp(entry.recencyAt) ?? timestamp(entry.updatedAt);
            if (key && time) cache.set(key, time);
          }
        }
      } catch { /* 主机离线/缓存不可用时不推测时间，下一轮再读。 */
        for (const key of items.values()) cache.delete(key);
      } finally {
        for (const resource of resources) {
          if (proxies.delete(resource)) release(resource);
        }
      }
      if (!stopped) render(Array.from(document.querySelectorAll(rowSelector)).slice(0, maxRows));
    }
  } finally {
    busy = false;
    if (dirty && !stopped) { dirty = false; schedule(); }
  }
}
function schedule() {
  if (stopped || scheduled) return;
  // 先清除复用行的旧标签，读取操作合并为单个有界批次。
  render(Array.from(document.querySelectorAll(rowSelector)).slice(0, maxRows));
  scheduled = setTimeout(() => { scheduled = undefined; void refresh(); }, 100);
}
observer = new MutationObserver(records => {
  const relevant = records.some(record => {
    if (record.type === 'attributes') return record.target instanceof Element && record.target.matches(rowSelector);
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    if (target?.closest(`[${marker}]`)) return false;
    const changed = [...record.addedNodes, ...record.removedNodes]
      .filter(node => !(node instanceof Element && node.hasAttribute(marker)));
    // 正文流式增量与侧栏无关；只关心行内内容、行本身及包含行的容器。
    if (target?.closest(rowSelector)) return changed.length > 0;
    return changed.some(node => node instanceof Element &&
      (node.matches(rowSelector) || node.querySelector(rowSelector)));
  });
  if (relevant) schedule();
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: [prefix + 'id', prefix + 'host-id', prefix + 'kind'] });
interval = setInterval(schedule, 30000);
await refresh();
