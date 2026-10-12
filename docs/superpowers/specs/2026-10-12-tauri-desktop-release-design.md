# Tauri 桌面启动器与更新设计

用户已选择迁移 Tauri，并要求参考安卓 App 新增桌面构建流水线和更新能力。沿用已讨论的 Tauri 外壳 + 独立 Node 后台，保留 Mobile/时间插件、配置目录和桌面控制协议。

- 第一阶段 macOS arm64/x64 与 Windows x64；补齐 Windows 路径、剪贴板、子进程树和桌面启动适配。Linux 暂不发布。
- Tauri 负责菜单栏、窗口、系统交互、单实例与更新；React 界面复用。Node sidecar 运行通用 LauncherController/PluginManager，继续加载配置目录插件。
- Node sidecar 与宿主用 stdin/stdout JSON RPC；插件页面经限定资源协议加载，只有父页面可调用宿主 IPC。退出或更新先关闭插件、网关和后台，不能残留子进程。
- 使用用户已有 Node.js 20+，优先显式路径，其次 PATH 与常见安装目录；启动前检查版本和可执行性，缺少或低版本时在窗口提示。仅打包生产依赖，不携带 Node、Electron 或 Chromium。
- 延用 codex-mobile 配置目录与既有迁移逻辑；保留 Electron 入口作为开发回退，不作为桌面流水线产物。
- 参考安卓更新交互：当前版本、检查更新、新版说明、下载进度、安装并重启。更新使用 Tauri 官方签名验证，不绕过签名。
- 桌面版本及发布通道独立：desktop-vX.Y.Z；不得修改安卓依赖的 GitHub latest Release。固定桌面更新索引只在完整签名产物发布成功后更新。
- CI secrets保存私钥，公开变量提供公钥；缺少签名配置时正式发布明确失败。开发构建可以无更新能力，不能假装可更新。
- 本轮编写和验证代码、流水线及打包；不自动推送、创建远端Release或修改仓库Secrets。真实升级验收使用受控测试包，不操作真实ChatGPT。
