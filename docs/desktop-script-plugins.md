# 桌面脚本插件

启动器负责发现、启停、注入、撤销和重新加载。功能脚本独立保存于用户配置目录，不写入 ChatGPT 安装包，也不硬编码到启动器的注入逻辑里。

后台与配置页面插件见 [统一插件 SDK](launcher-plugin-sdk.md)。

## 使用会话时间插件

1. 启动 CDP 桌面连接。
2. 在启动器的「插件」页找到「会话时间」，打开开关。
3. 桌面 Codex 会话行显示最近更新时间，如「刚刚」「2 分钟」「3 小时」；悬停标签显示完整本地日期时间。时间放在原生标题横排内部，不增加行高，并保留状态图标与菜单。优先级排序的摘要行会将时间插入内部标题行，沿用原生按钮预留空间，避免与置顶、菜单按钮重叠。
4. 关闭开关会撤销标签、样式和观察器。停止该插件或退出启动器也会卸载脚本；停止 Mobile 不影响时间插件。

会话时间插件首次默认开启；用户手动关闭后，重新加载和重启均保留该选择。其他插件可通过 manifest 的 `defaultEnabled` 声明首次默认状态，未声明则关闭。界面区分未启用、等待桌面连接、已注入和注入失败。页面刷新后，启用中的脚本会重新注入。

当前时间插件优先读取 `localThreadCatalog.readEntries` 的 `sourceUpdatedAt`（按 host/thread 定位，每批最多 100 条）；目录服务缺失时使用 `appServerManagers` 缓存。两者都是已有 Codex 缓存，不加载完整历史、不发送消息、不修改会话。通过原生行属性关联 host 和 thread ID，仅处理已核对的 Codex 行；没有有效时间的行不添加标签。单轮限制 200 行、8 个主机，定期刷新时间。已适配脚本内列出的 `26.1002.52244` 和 `26.1007.30912` 两个桌面版本；其他版本显示错误，需调整插件适配。

## 文件位置

点击「打开插件目录」可直接进入实际目录。标准安装路径示例：

```text
~/Library/Application Support/codex-mobile/
├── config.json
├── plugins.json                       # 开启状态
└── plugins/
    └── desktop-thread-time/
        ├── manifest.json              # 名称、ID、入口
        └── inject.js                  # 注入脚本
```

目录以启动器实际 config.json 所在位置为准。源码模板位于仓库 `plugins/`，随应用包分发；首次初始化只复制不存在的插件文件夹，不覆盖已经复制或由用户修改的脚本。

编辑配置目录中的 `inject.js` 后，点击「重新加载插件」即可生效，不需要重新打包启动器。重新加载会先卸载旧脚本，再重新读取本地 manifest 和入口文件。

## 插件声明

```json
{
  "id": "desktop-thread-time",
  "name": "会话时间",
  "description": "在桌面会话列表显示最近更新时间",
  "version": "1.0.2",
  "entry": "inject.js",
  "defaultEnabled": true
}
```

每个插件放在一个独立文件夹。ID 必须唯一；入口路径必须留在该插件目录内。启动器拒绝目录／manifest 符号链接、逃逸入口、重复 ID 和超限文件，并在插件页报告问题。

## 脚本契约

`inject.js` 是 async function 的函数体，支持顶层 `await`，不是 CommonJS 或静态 ES module。宿主提供：

```ts
context.signal: AbortSignal
context.onDispose(cleanup: () => void | Promise<void>): void
```

最小示例：

```js
let badge;
// 必须在第一个 await 之前注册清理逻辑。
context.onDispose(() => badge?.remove());
if (context.signal.aborted) return;

badge = document.createElement('span');
badge.textContent = '插件已启用';
badge.dataset.examplePlugin = '';
document.body.append(badge);
```

异步操作完成后再次检查 `context.signal.aborted`，避免关闭插件后写入迟到结果。需要清理的内容包括 DOM、样式、定时器、MutationObserver、事件监听和原生代理资源。清理函数应幂等且及时返回；初始化和卸载有超时限制，失败在插件页显示。

当前支持受信任的本地脚本。脚本执行于桌面 renderer，可访问页面和已有内部服务；这不是第三方代码沙箱，也没有逐 API 的权限隔离。不要把此前设计草案里的 `ScopedDesktopApi` 或细粒度 capability 当作本版已实现功能。

## 与未来插件系统的关系

本版实现的是「配置目录脚本＋开关＋注入生命周期」。后续可以在这层之上增加插件 SDK、权限、安装来源和升级管理。原生桌面 API 能力见 [桌面内部 API 参考](desktop-internal-api.md)。

验证使用自建 Electron 页面和原生行标记模拟，覆盖文件修改后重载、页面刷新重新注入、关闭清理等链路；真实桌面效果需要在启动器中开启后确认。
