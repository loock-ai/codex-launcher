## Codex Launcher 快速体验

桌面启动器管理 Mobile 与桌面注入插件，可在浏览器中查看桌面的项目、会话、消息，继续对话和处理审批。安卓客户端继续使用 Codex Mobile。

### 下载哪个文件

| 电脑 | 安装包后缀 |
| --- | --- |
| macOS 13.5+，Apple Silicon（M 系列） | `darwin-aarch64.dmg` |
| macOS 13.5+，Intel | `darwin-x86_64.dmg` |
| Windows 10+，x64 | `windows-x86_64.exe` |

`SHA256SUMS.txt` 提供安装包校验值。无需下载源码、安装 Rust 或自行构建。

### 三步开始

1. 安装 [Node.js 20 或以上版本](https://nodejs.org/zh-cn/download)，并准备已安装、已登录的 ChatGPT/Codex 桌面端。安装包使用本机 Node，不内置 Node 运行时。
2. macOS 打开 DMG，将 **Codex Launcher.app** 拖到“应用程序”后打开；Windows 运行 EXE 安装器。首次打开在“桌面”页核对桌面应用路径、CDP 端口（默认 `9333`）；若桌面未开启 CDP，可使用“强制重启 ChatGPT”连接。该操作会直接关闭并重启桌面应用，先处理好正在运行的任务。
3. 在“插件”页打开 **Mobile → 配置 → 打开 Web**。手机与电脑连接同一网络，展开二维码扫码，或复制完整连接链接。选择项目和会话即可体验；完整链接包含访问口令，请勿公开分享。

### 首次打开与更新

当前安装包未配置 Apple 公证或 Windows Authenticode 签名。macOS 若提示无法验证开发者，可在“系统设置 → 隐私与安全性”查看允许打开选项；Windows 可能显示发布者提示。Windows 需要 WebView2 运行环境。

自动更新仅在发布者配置更新签名后可用；未配置时可从 Release 下载新安装包手动更新。

[完整使用说明](https://github.com/loock-ai/codex-launcher#快速开始) · [发布与更新说明](https://github.com/loock-ai/codex-launcher/blob/main/docs/desktop-release.md)
