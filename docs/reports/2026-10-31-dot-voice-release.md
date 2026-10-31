# Dots 语音版本发布与本机正式版升级

## 1. 已发布版本

| 组件 | 正式版本 | 发布记录 |
| --- | --- | --- |
| Codex Launcher | 0.2.0 | [桌面 Release](https://github.com/loock-ai/codex-launcher/releases/tag/desktop-v0.2.0) |
| Mobile 插件 | 1.2.0 | [插件 Release](https://github.com/loock-ai/codex-launcher-plugins/releases/tag/mobile-v1.2.0) |
| Codex Mobile 安卓 App | 0.2.34 | [App Release](https://github.com/loock-ai/codex-launcher-plugins/releases/tag/v0.2.34) |

语音直接接入原 Dots 对话页。独立人工验收页面已删除，不在正式插件包内。

源码提交：宿主 `cf4c006fa9ce8987eae7b98117658d27e43b19d8`，插件与安卓 App `f4fa9f1dc1bfc709f5a55a42dc6641ff0477fb31`。两个仓库均已推送到 main；其他原有未提交修改未混入提交。

## 2. 自动发布与验证

- [桌面流水线](https://github.com/loock-ai/codex-launcher/actions/runs/41189808495)：云端校验、Apple Silicon、Intel、Windows 构建、后端冒烟及发布均成功。
- [Mobile 插件流水线](https://github.com/loock-ai/codex-launcher-plugins/actions/runs/41189632669)：发布、下载回读、目录更新均成功。插件发布需 workflow_dispatch，本次已主动触发。
- [安卓流水线](https://github.com/loock-ai/codex-launcher-plugins/actions/runs/41189619037)：推送 main 自动递增版本、构建、发布和 App 更新索引回读均成功；iOS 构建按现有配置跳过。
- 本地最终校验：宿主 706 项通过、11 项按环境跳过；插件 Mobile 448 项通过、1 项浏览器专用测试默认跳过；类型检查和构建通过。真实网页拨号另见 [验证记录](2026-10-31-dot-voice-validation.md)。

三个桌面安装包和安卓 APK 均已额外下载到本机，比对发布的 SHA-256 校验文件；插件 ZIP 由宿主按锁文件下载并校验。所有校验均通过：

| 文件 | SHA-256 |
| --- | --- |
| CodexLauncher-0.2.0-darwin-aarch64.dmg | `77ebb8cc3d4301484230e0733d62e19cd22c6f3ff70e2bf62c707513cbeeadf7` |
| CodexLauncher-0.2.0-darwin-x86_64.dmg | `84d34431c8f790ce45178fc0605ca53fccf07d7be029443ae2961599930165f6` |
| CodexLauncher-0.2.0-windows-x86_64.exe | `ca6001d9a60dd0d564dfc8c12c3fa604e0ab896ff9f49f5fa07fc0781fbf576f` |
| mobile-1.2.0.zip | `8fe1283ee389360e641036bee4c8537b0bbc6f567dd4fec6201760e1c8e0bb50` |
| CodexMobile-v0.2.34.apk | `83efff9c3de2e6d3026409834823e176921c27aa6257ed22a397a853948c599e` |

桌面更新签名尚未配置，流水线按既定规则发布安装包，不更新自动升级频道；可下载后手动更新。已有用户需要同时具备支持语音信令的 Launcher 和 Mobile 1.2.0。

## 3. 本机正式版升级

用户要求本机升级后，使用已验证的 arm64 DMG，检查包内 Launcher 0.2.0 和 Mobile 1.2.0，再备份并按原路径替换本机应用：

`/Users/loock/myFile/codex-web-mobile/src-tauri/target/release/bundle/macos/Codex Launcher.app`

Mobile 使用正式插件安装器更新到 1.2.0，保留旧代码备份，并更新安装记录与真实代码树哈希。本机检查结果：

- 应用 Info.plist 版本为 0.2.0，实际运行原安装路径的新进程。
- 原生 About 窗口确认 Version 0.2.0 (0.2.0)，插件页显示 Mobile 1.2.0 运行中，桌面页显示已连接。
- Mobile 清单及安装记录均为 1.2.0，安装代码树哈希匹配，未被识别为本地修改。
- 桌面状态与语音能力均为 true，原网关继续使用 19877。
- 桌面设置、插件自启策略、Mobile 配置及其他插件安装记录保持不变。
- 只重启 Launcher，ChatGPT PID 保持不变；未更新另外两台电脑。
- 安装镜像已卸载。

升级前应用及配置备份：`/Users/loock/Library/Application Support/CodexLauncherBackups/20261031-175902-upgrade-0.2.0/`。

Mobile 安装器的旧代码备份：`/Users/loock/.codex-launcher/plugin-backups/mobile/1793440767706-efa8c9ab/`。
