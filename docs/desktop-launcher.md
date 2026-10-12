# Codex 启动器

启动器是 macOS 菜单栏应用，支持桌面 CDP 桥接、托管和外部 app-server。源码已合并到 `main`；应用包可从源码构建，目前未签名。

## 启动

打开 `launcher-release/mac-arm64/Codex 启动器.app`，点击菜单栏 `⌘` 图标。

1. 在「设置」选择连接模式并保存。
2. 启动器打开后自动启动 Web 服务；连接成功后点击「打开 Web」。
3. 在「连接」页点击「展开二维码」后扫码，手机与电脑连接同一局域网。二维码默认收起。
4. 在手机现有界面选择桌面会话。CDP 模式通过结构化控制通道读取所选主机的项目、会话和历史，发送消息并处理审批；运行中的会话支持补充引导和非阻塞问题回答。
5. 「停止连接」关闭启动器自己的网关与托管 app-server；CDP 模式保留 ChatGPT 应用。

配置默认保存在 `~/.codex-launcher/config.json`，插件在 `~/.codex-launcher/plugins/`，首次启动新版迁移旧的应用数据目录且不覆盖已有新目录。配置文件权限 0600。打开启动器后默认自动启动服务，不自动安装开机启动项。二维码带访问口令；日志隐藏口令。CDP 只使用本机地址，局域网网关必须鉴权。

## 三种模式

| 模式 | 用途 | 手机与桌面的关系 |
| --- | --- | --- |
| 桌面 CDP 桥接 | 通过实际 ChatGPT Desktop 的既有服务接入 Codex 和 Dots | 结构化会话、历史、消息、附件与审批；Dots 使用独立入口 |
| 原 Codex Mobile | 启动原 gateway 与托管 app-server | 保留原模式，独立 app-server 会话，不保证与桌面同步 |
| 外部 app-server | 连接已经运行的本机 app-server | 保留原协议行为 |

默认网关端口 19877、CDP 端口 9333、托管 app-server 端口 19876。启动器拒绝端口冲突配置，不关闭占用端口的其他进程。

ChatGPT 已运行但未开放 CDP 时，可点击「强制重启 ChatGPT」。该操作直接执行，不弹确认框：先停止手机桥接，再按配置安装包的准确主进程路径终止 ChatGPT，随后以本机 CDP 参数启动并重新连接。任务、草稿或审批不会阻拦强制重启。

## Desktop 内置 CLI

原 Codex Mobile 模式根据选择的 `.app` 路径查找其安装包 CLI，不依赖全局 `codex` 或 shell PATH。当前安装版实际路径：

```text
/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex
```

这是安装包提供的 shell 入口，最终调用：

```text
/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex
```

优先读取 `codex-cli/codex-package.json` 中的 `entrypoint`，其次检测现代入口与旧版 `Contents/Resources/codex`。找不到可执行文件时显示错误。旧配置中全局 CLI 路径会迁移为所选 Desktop 包路径，设置页 CLI 字段只读。

2026-10-02 本机实测：ChatGPT `26.930.21537`，内置 CLI `0.159.0-alpha.12.1`；通过打包应用启动托管网关，`/api/host` 返回 `appServerReady: true`，WebSocket initialize 返回 `Codex Desktop/0.159.0-alpha.12.1`，再停止服务成功。

## 支持范围与验收边界

已实现文本输入、可见历史与流式回复、会话切换、停止生成、桌面原文审批选项、审批失效清理、多手机连接与重新连接。手机 UI 继续使用原 React 前端。旧 DOM CDP 通道仍禁用附件与设置修改；当前结构化 desktop-control 通道支持附件上传、模型与权限显式选择，详见 desktop-control-channel.md。发送结果未知时不自动重发；审批仅点击具有相同请求身份与原文选项的按钮。

当前验证结果：

- 完整 Vitest：372 通过、2 跳过。类型检查、前后端构建、arm64 `.app` 打包、diff check 通过。
- 独立启用的真实 Electron/CDP 受控测试通过：中文多行输入、流式回复、完成事件、审批拒绝；复用手机前端通过网关完成发送与拒绝审批。受控页面不是 ChatGPT 账号。
- 打包启动器的实际渲染页面与 IPC、设置保存、二维码、原模式网关启动/握手/停止已验证。
- 实际 ChatGPT 本机 CDP 端口、主窗口选择、React 路由、编辑器与侧栏结构已通过只读检查。
- **真实 ChatGPT Codex/Dots 文本收发及审批尚未验收。** Computer Use 工具拒绝操作 `com.openai.codex`，提示安全限制；没有绕过拒绝进行真实账号写操作。Dots 路由、消息行与审批请求身份已按安装包静态代码补充适配，并通过受控页面测试；实际渲染布局与交互仍需人工实测，不能视为已证明兼容。

独立审查发现的会话检查、草稿原子操作、审批身份匹配、快速完成与过期审批事件问题已修复并增加回归测试。

截图：`docs/assets/launcher/settings.png`、`docs/assets/launcher/mobile-fixture.png`。两者分别记录早期设置界面与受控测试画面；连接二维码截图仅在本机保留。

## 源码运行与重新构建

```sh
npm install
npm run build:launcher
npm run launcher
npm run package:launcher
npm test
RUN_CDP_FIXTURE=1 npm test -- tests/server/cdp-live.integration.test.ts
```

`bin/codex-mobile.mjs` 新增 `bridge` 与 `launcher` 命令；原 `start`、`auth`、`desktop` 保留。核心实现位于 `server/cdp/`、`server/launcher/` 与 `launcher/`。

后续真实验收：分别在桌面 Codex 与 Your dot 打开可测试会话，用手机发送一条唯一标识文本，对照双方消息与流式状态；触发一个人工认可的审批，确认两端显示同一请求与选项，点击后检查桌面结果；再验证桌面主动发送和手机重连。不要使用正在执行重要工作的会话做首轮验收。

## Dots 适配依据与新增回归（2026-10-02）

只读检查本机 `ChatGPT.app/Contents/Resources/app.asar` 内的 `webview/assets`，没有操作真实账号页面：

- `app-shared-59042e7300f7.js` 定义 `/dots/:conversationId` 与 `/o/:conversationId`，并区分 home/new/claim-email/approve。桥接排除这些非会话路由。
- `composer-controls-948222e6c0f2.js` 渲染 `article.message-row[data-message-id]`、`.self`/`.assistant`、`.message-text` 与 `.typing-indicator[data-visible]`。桥接读取正文，排除回执、附件按钮与其他 UI 文案。
- `native-room-87b643e97ce2.js` 与 `card-b2de4a2ca285.js` 的 Dots 审批组件使用 `roomId` 与 `request.request_id/thread_id/turn_id`。桥接把这些字段组合成审批身份，按钮仍沿用桌面原文。
- 每次快照清除上次由桥接生成的审批定位属性，再从现存 React 请求重新识别；组件复用后不会留下已消失请求。

新增四项回归测试先失败、修复后通过；独立 Electron/CDP fixture 覆盖 `/o/fixture-dot` 消息发送、回读、完成状态及 snake_case 审批拒绝。此验证仍不等于实际 ChatGPT/Dots UI 验收。

当前目标状态：受阻（blocked），不是全部完成。2026-10-02 再次使用 Computer Use 只读选择真实应用，仍被安全策略拒绝。需要工具允许真实界面操作，或由用户完成人工真实验收后提供结果。尚未验证的原生菜单栏点击与弹出交互也一并保留为验收项。

## 路由识别修正（2026-10-02）

用户实际运行报告 `desktopRoute` 的“桌面路由不可识别”。旧算法把整个 React 树所有 `location` 属性混在一起，要求只有一个 pathname。安装包 React Router 的 LocationContext 包含 `value.location` 与 `value.navigationType`；嵌套 Route 或普通组件可持有其他 location。已增加回归复现，改为优先使用最外层 LocationContext 的身份，同层冲突仍拒绝操作。缺少根或路由未就绪时给出具体错误，面板隐藏 evaluate 堆栈。

完整测试 370 通过、2 跳过；真实 Electron/CDP fixture 增加多个 location 干扰，Codex/Dots 协议测试通过；重新构建和打包通过。实际用户页面具体属于“多个候选”还是“尚未初始化”仍需新版运行结果确认，不把 fixture 测试当作用户现场已修复的证明。

## Linghou 指定网页验证（2026-10-02）

使用用户指定本地 Edge 的 tab 1529460054，页面标题 Codex Remote，origin 为 http://192.168.100.17:19877。执行 browsers list、tabs_list、Markdown、snapshot 与只读页面状态检查，没有发送消息、点击会话或审批。页面显示“无法加载会话 / 桌面输入框存在歧义”，发送框与发送按钮均 disabled。网关缓存 `/api/status` 返回 mode=cdp、appServerReady=false、clients=1，最后错误为 connect ECONNREFUSED 127.0.0.1:9222。系统端口检查没有 9222 listener，ChatGPT 主进程仍在运行。

可见性识别原来只检查 HTML hidden/aria-hidden/inert，未排除祖先 CSS display:none 与 visibility:hidden/collapse。已增加失败回归并修正读快照的判断，使其与操作时的 CSS 可见性检查一致。372 项测试通过；独立 Electron/CDP fixture、类型构建与重新打包通过。需要用户点击“重启并连接桌面”恢复调试端口后再次实测，仍不能声称当前真实桌面收发成功。

## 2026-10-09 更新：启动器打开现有 Web

CDP 模式已从 DOM 桥切为结构化 desktop-control 网关。面板及托盘“启动并打开 Web”会先启动服务，再打开含本机访问口令的网页。列表、历史、文本收发、新建与停止任务通过桌面已有IPC连接；原 app-server 模式保留。新配置默认CDP端口9333，实际配置需与手动启动的桌面一致。

Web 的审批入口处理已收到的请求；当前安装包的AppHost可能接管审批，真实全部审批兼容性尚未验证。不要将受控窗口验证等同于实际账号成功。详见desktop-control-channel.md。

## 通过命令启动并打开 Web

源码环境（已安装依赖并执行 `npm run build:launcher`）：

```bash
node bin/codex-mobile.mjs launcher --open-web
```

macOS 打包版本（路径按实际安装位置替换）：

```bash
open -n "/Users/loock/myFile/codex-launcher/launcher-release/mac-arm64/Codex 启动器.app" --args --open-web
```

`-n` 确保 macOS 将参数交给启动器；启动器的单实例机制会把命令转交已运行实例，不创建第二个网关。命令等初始化完成后调用现有连接流程，连接成功才用系统默认浏览器打开带访问口令的 Web 地址。使用保存的模式、端口和口令；不会打印口令，也不会自动确认重启桌面。失败由启动器显示错误，后续命令仍可继续执行。`open` 的退出码只表示已派发，不代表连接成功。

不传 `--open-web` 时仍只显示启动器面板。
