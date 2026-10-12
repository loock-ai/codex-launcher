# 启动器插件开发接口

更新：2026-10-12。本文描述当前源码已实现的统一插件运行器。桌面外壳现为 Tauri 2，独立 Node 后台继续实现本文接口；Electron 入口作为开发回退。插件代码来自配置目录，宿主提供生命周期、配置存储、桌面连接与页面容器。Mobile 已迁为插件，Web 与 Dots 共用原有前端和网关逻辑。

## 文件与配置

```text
~/.codex-launcher/
├── config.json                    # schemaVersion:2，共享 desktop 配置
├── config.json.v1.bak             # 从旧版迁移时保留的原始配置
├── plugins.json                   # enabled、autoStart、known、removed
├── plugin-repositories.json       # 可配置仓库与分支
├── plugin-installations.json      # 已安装代码哈希及来源绑定
├── plugin-data/<id>/config.json   # 各插件独立配置
└── plugins/<id>/
    ├── manifest.json
    ├── main.cjs                   # 可选：Node 后台
    ├── ui/index.html              # 可选：启动器配置页面
    └── inject.js                  # 可选：桌面注入脚本
```

内置模板仅在目标目录不存在时复制，不覆盖用户修改。修改插件代码后点击「重新加载插件」。已安装模板不会随着启动器升级自动覆盖；更新现有插件时应保留自己的改动，替换对应插件文件后重载。Mobile 的 Web 静态资源放在该插件的 `web/` 目录。

Windows 配置目录位于 `%USERPROFILE%/.codex-launcher/`，插件结构相同；桌面应用路径填写实际 `.exe`。

旧配置迁移先备份，再将 Mobile 的端口、口令、监听地址、模式与上游地址保存到独立配置，最后写入共享桌面配置。已存在的 Mobile 配置不覆盖。

## 声明

```json
{
  "manifestVersion": 2,
  "launcherApiVersion": "1",
  "id": "example",
  "name": "示例功能",
  "version": "1.0.0",
  "defaultEnabled": false,
  "autoStartDefault": false,
  "entrypoints": {
    "main": "main.cjs",
    "ui": "ui/index.html",
    "desktop": "inject.js"
  }
}
```

用于独立更新的插件目录名必须与 manifest 的 `id` 一致；已有非规范目录可继续加载，但需先重命名后才能更新。目标目录被其他插件 ID 占用时拒绝覆盖。

至少提供一个入口；无需某入口时省略。路径必须位于插件目录内，不支持符号链接。旧版 `entry: "inject.js"` 自动视为 desktop 入口，保留桌面脚本兼容。

「启用」加载后台与配置页；「启动」启动功能和桌面注入；「停止」回收服务但保留后台以便修改配置；「禁用」卸载整个插件。「自动启动」控制启动器启动或重载后的功能启动。一个插件失败不会阻止其他插件启动。桌面未就绪时进入等待状态，连接桌面后重试等待插件。

## 后台 SDK

后台当前使用 CommonJS，导出 `activate(ctx)`：

```js
exports.activate = async ctx => {
  let config = await ctx.config.read({ greeting: '你好' });
  ctx.actions.register('config.read', () => config);
  ctx.actions.register('config.save', async next => {
    await ctx.config.write(next);
    config = next;
    return config;
  });
  return {
    start: async () => {},
    stop: async () => {},
    getStatus: () => ({ state: 'stopped' }),
    deactivate: async () => {}
  };
};
```

| API | 行为 |
| --- | --- |
| `ctx.pluginDir` / `ctx.dataDir` | 插件代码目录／独立数据目录 |
| `ctx.config.read(defaults)` | 默认值与已保存配置合并 |
| `ctx.config.write(object)` | 原子保存该插件配置，文件权限 0600 |
| `ctx.actions.register(name, handler)` | 注册配置页可调用动作，参数与结果需可序列化 |
| `ctx.host.call(method, params)` | 调用下表共享宿主能力 |
| `ctx.host.subscribe(listener)` | 订阅宿主事件，返回取消订阅函数 |
| `ctx.status.publish({state,...})` | 发布插件状态；业务详情由插件自己的 status.get 返回 |
| `ctx.log(...args)` | 启动器日志；插件应自行脱敏 |
| `ctx.onDispose(fn)` / `ctx.signal` | 卸载清理与中止信号；stop 也必须主动回收服务 |

Tauri 使用用户已安装的 Node.js 20 或以上版本。后台在独立 Node 进程运行，崩溃或生命周期超时会回收进程组及宿主租约。请求超时表示结果未知，宿主不会自动重发写操作。插件必须让 stop 可重复调用。

## 共享宿主方法

桌面接口必须先申请租约，后续请求携带该 `leaseId`。租约绑定调用插件，不能使用其他插件的租约。最后一个消费者释放后才关闭控制连接，不退出桌面应用。

| 方法 | 参数／结果 |
| --- | --- |
| `desktop.details` | 返回 appPath、cdpPort、cliPath；CLI 未发现时为空 |
| `desktop.acquire` | 返回 `{leaseId}`；桌面未就绪返回 `DESKTOP_NOT_READY` |
| `desktop.release` | `{leaseId}` |
| `desktop.control.status` | `{leaseId}`，读取控制状态 |
| `desktop.control.hosts` | `{leaseId}`，读取主机列表 |
| `desktop.control.request` | `{leaseId,hostId,method,params,timeoutMs?}`，沿用控制通道方法白名单 |
| `desktop.control.pendingApprovals` | `{leaseId}`，当前审批与问题快照 |
| `desktop.control.respond` | `{leaseId,approvalId,result}` |
| `desktop.control.setUserQuestionTargets` | `{leaseId,targets:[{hostId,threadId}]}`，每租约最多 8 项 |
| `desktop.control.refreshUserQuestions` | 同上，刷新问题快照 |
| `desktop.dots.status` | `{leaseId}`，Dots 可用状态 |
| `desktop.dots.request` | `{leaseId,request}`，沿用 Dots 路径与账户校验 |
| `system.openExternal` | `{url}`，仅 HTTP/HTTPS，无 URL 用户凭据 |
| `clipboard.writeText` | `{text}` |

控制事件为 `{type:'desktop.event',leaseId,event}`。Desktop 注入入口由运行器调用 `desktop.inject` / `desktop.uninject` 管理，不需要 Mobile 启动。具体项目、会话和消息方法见 [内部 API](desktop-internal-api.md) 与 [网关 API](plugin-api-reference.md)，注意内部接口和对外网关的允许范围不同。

## 配置页面桥接

页面在隔离 iframe 加载，没有 `window.launcher`、Node 和直接网络能力。JS/CSS 使用插件目录中的外部文件，不使用内联脚本。

```js
parent.postMessage({
  type: 'launcher-plugin-request',
  id: 'request-1',
  action: 'config.read',
  params: {}
}, '*');
window.addEventListener('message', event => {
  if (event.source !== parent) return;
  if (event.data?.type !== 'launcher-plugin-response') return;
  // 根据 id 关联请求，读取 result 或 error。
});
```

宿主将请求绑定到当前 iframe 对应的插件，页面不提交 pluginId。`__runtime.start` / `__runtime.stop` 为保留动作；其他动作交给插件后台。切换或关闭配置页不停止后台服务。

## Mobile 动作

`status.get`、`config.read`、`config.save`、`connection.read`、`open-web`、`copy-url`、`approvals.list`、`approvals.respond`、`logs.read`。配置页、二维码和三个连接模式都由 Mobile 实现。`--open-web` 仅作为启动器命令兼容入口调用 Mobile 的 `open-web`；禁用 Mobile 时不会偷偷重新启用。

## 当前边界

仅面向可信本地插件。进程隔离用于故障回收，不是恶意代码沙箱。`permissions`、`pages`、`actions` 声明目前仅为描述性元数据，不构成逐能力授权；页面入口来自 `entrypoints.ui`，动作来自后台注册。已提供官方目录检查更新、用户主动安装、SHA-256 校验、代码备份和失败回滚；暂不包含插件市场、后台自动安装或独立签名认证。开发者应将后台打包为 CommonJS，并明确运行所需依赖。

Windows 正常停止使用 taskkill 回收仍存活的插件进程树；worker 已先行异常退出时，孤儿后代的完整回收仍需 Windows 真机验证和 Job Object 兜底，当前不宣称已覆盖这一边界。

## 独立版本发布

插件源码在 [codex-launcher-plugins](https://github.com/loock-ai/codex-launcher-plugins) 中维护。顶层目录包含 `id/name/description/version/git/compatibility/release`。Git 信息用于查看源码和追溯；启动器使用预构建 ZIP，不运行远端 git pull 或 npm install。

`main` 必须携带自身运行依赖。Mobile 的发布包已经内联其 Node 依赖、打包 Web，并包含兼容旧构建的源码；后者是构建输入，运行时通过 `ctx` 使用宿主，而不是读取 Launcher 源码。宿主 API 当前版本为 `1`。

更新管理属于启动器主界面能力：`checkPluginUpdates`、`updatePlugin(id,{allowLocalChanges})`。插件后台和配置 iframe 不获授权修改其他插件。配置和启用策略不随 ZIP 更新；本地修改要求明确保留备份后覆盖，回滚不会重放业务写操作。

## 仓库管理与删除

主界面提供 `listPluginRepositories`、`addPluginRepository`、`editPluginRepository`、`setPluginRepositoryEnabled`、`removePluginRepository`；这些不是插件 iframe 或 `ctx.host` 的权限。官方仓库只在缺少初始配置时默认添加，空仓库列表代表用户已删除，不会自动恢复。

第三方公开 GitHub 仓库也采用 schemaVersion=1 的顶层 `plugins.json`。`repository` 必须匹配添加的仓库；每个插件的 `git.url` 和 `release.url` 都指向同一仓库，Release 需为 ZIP 并附 SHA-256。源码 `git.path` 可为安全的相对路径或 `.`，Git ref 可采用该仓库自己的标签格式。当前不支持私有仓库凭据、GitLab 或任意下载域。

`checkPluginUpdates` 仅读取目录。`updatePlugin(id,{repository,allowLocalChanges})` 才下载；同 ID 未安装插件必须指定来源，已安装插件禁止静默切换来源。旧安装记录自动归属原官方仓库。

`uninstallPlugin(id)` 停止并清理目标插件请求，备份其代码，移除启用和自启策略及来源记录，保留独立配置。`plugins.json.removed` 防止内置模板在重启时重新复制。再次从仓库主动安装时清除此删除记录。删除失败会恢复代码与状态；其他插件不重载。
