# 独立插件仓库与 Launcher 更新实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（当前会话直接实施）或 superpowers:subagent-driven-development（用户选择委派后）逐任务执行。使用复选框记录完成状态。

**Goal:** 将会话时间和 Mobile 拆到 `loock-ai/codex-launcher-plugins`，发布自包含插件包，Launcher 通过顶层插件目录独立安装更新。

**Architecture:** 新仓库是插件业务源码的唯一维护位置；Launcher 保留桌面共享连接、插件运行器和稳定 IPC API。每个插件使用独立版本 Release，目录指向固定包及 SHA-256；安装与回滚只替换插件代码，保留本地配置和启用策略。

**Tech Stack:** TypeScript、Node.js 20+、React/Vite、esbuild、JSON Schema/Ajv、Vitest、Tauri 2/Rust、GitHub Actions。插件归档使用 ZIP，通过成熟解压库读取并校验，不执行包内安装脚本。

**Spec:** [已确认设计](../specs/2026-10-12-independent-plugin-repository-design.md)

## Global Constraints

- 仓库名 `codex-launcher-plugins`，归属 `loock-ai`；与现有 Launcher 一致使用公开仓库。
- 插件 API 版本 `1`，Node.js `>=20`；Mobile 和会话时间独立 SemVer。
- 本机目录 `~/.codex-launcher/`；插件数据位于 `plugin-data/<id>/`。
- 安卓仍为 Codex Mobile；包名、npm CLI 名称保持兼容。
- 不覆盖本地插件修改，不重放发送消息或审批，不更新不兼容插件。
- 不提交访问口令、真实二维码、配置副本或已有两份无关本地草稿。
- 未经新指令不扩展到插件市场、后台自动安装或第三方账号权限。

## Review Focus

- 旧目录迁移时插件代码、口令、开关是否完整保留：任务 1。
- 自包含插件包是否错误依赖宿主 node_modules 或相对源码：任务 2。
- 目录和真实资产版本不一致或重复 ID：任务 3。
- ZIP 路径穿越、符号链接、体积与文件数量超限：任务 5。
- 本地修改、插件启停、更新并发、重载失败和回滚失败：任务 5/6。

## Task 1：提交已完成的目录迁移

**Files:** Launcher `src-tauri/src/config_directory.rs`、`src-tauri/src/main.rs`、`launcher/config-directory.cjs`、`launcher/main.cjs`、相关文档和目录迁移测试。时间列表旧测试修正单独提交。

**Interfaces:** 默认 `resolve(home,data,explicit)` / `resolveConfigDirectory(home,appData,explicit)` 返回 `.codex-launcher`；显式配置路径不迁移。

- [ ] 核对既有 RED→GREEN 记录：两个 Rust 迁移测试、Electron 迁移测试；实际迁移 20 个文件 SHA-256 无差异。
- [ ] 运行 `npm run typecheck`、`npm test` 和 Rust 测试；确认 666 项 JS 测试通过，11 项门控跳过，构建成功。
- [ ] 只暂存迁移文件提交；测试旧时间文案修正另提交；规格和本计划另提交。

## Task 2：创建插件仓库并实现独立 Mobile 构建

**Files:** 新仓库 `AGENTS.md`、`README.md`、`package.json`、`package-lock.json`、`plugins/*/manifest.json`、`plugins/desktop-thread-time/inject.js`、`plugins/mobile/main.ts`、`plugins/mobile/ui/*`、`plugins/mobile/web-src/*`、`plugins/mobile/server/*`、`scripts/build-plugin.mjs`、`tests/plugin-package.test.mjs`。

**Interfaces:** `buildPlugin(id,outDir)` 生成单插件运行目录：manifest、main.cjs、ui、web、自身运行依赖。依赖宿主的调用仅使用 `ctx.host` API，不能导入宿主源码或查找宿主 node_modules。

- [ ] 写失败测试：将生成包复制到不含 Launcher/node_modules 的临时目录，以子进程加载 activate；会话时间包无 Node 后台；Mobile 三种模式所需资源与依赖均在包内。
- [ ] 新建本地 Git 仓库，移入两个插件；将 Mobile 所属 `src/`、网关、HTTP、上传、业务 Dots 适配及相关测试迁入对应子目录。
- [ ] 将 Mobile 对 `DesktopControlChannel` 具体类的依赖替换为插件内 `host-proxy.ts` 协议接口；桌面 CDP 操作实现留在 Launcher。按导入图逐文件移动，禁止保留两份维护副本。
- [ ] `buildPlugin` 打包自身 Node 依赖；带动态依赖的库如无法安全内联，保存在包内 node_modules 并固定 lockfile。运行时不执行 npm install。
- [ ] 运行新仓库完整测试、Web 构建和自包含包测试；验证文件树和许可证，创建 `loock-ai/codex-launcher-plugins` 并推送。

## Task 3：目录 Schema、独立发布与真实资产

**Files:** 新仓库 `plugins.json`、`schemas/plugins.schema.json`、`scripts/catalog.mjs`、`scripts/release-plugin.mjs`、`.github/workflows/release-plugin.yml`、`tests/catalog.test.mjs`、`tests/release-plugin.test.mjs`。

**Interfaces:** `validateCatalog(value)` 检验 schema；`resolvePlugin(catalog,id)` 返回目录项；`packagePlugin(id,version)` 输出 ZIP 与 SHA-256。目录字段严格对应规格。

- [ ] RED：重复 ID、非法版本、错误 Git/path/ref、缺失或非 HTTPS 下载地址、错误哈希、包内版本不符均拒绝。
- [ ] 实现目录校验；独立 tag 格式 `<id>-v<version>`；ZIP 顶层直接包含 manifest 与入口文件。
- [ ] 发布脚本先构建测试、生成包、上传草稿、下载验 hash，再正式发布；最后更新目录项。遇到未知上传结果先读回状态，不自动覆盖同版本资产。
- [ ] 分别发布会话时间和 Mobile 首个独立包；顶层目录只填真实 commit、资产 URL 和 SHA-256；新仓库测试与 Actions 全绿。

## Task 4：Launcher 构建固定引用插件发布包

**Files:** Launcher `plugins.lock.json`、`scripts/fetch-builtin-plugins.mjs`、`scripts/build-tauri.mjs`、`scripts/build-launcher.mjs`、`package.json`、`.github/workflows/build-desktop.yml`、原移动端构建脚本、迁移后的测试及文档。

**Interfaces:** `fetchBuiltinPlugins(lock,outDir)` 从固定版本包生成内置模板目录；`plugins.lock.json` 记录 ID、version、URL、sha256。源码来源不得指向浮动 main。

- [ ] RED：哈希错误不构建，断网已有校验缓存可复用，锁定版本不随远端目录改变。
- [ ] 用包缓存替代本地 `plugins/` 源码构建；删除已迁移源码，更新相关测试导入及文档。
- [ ] 保留 Android/npm 产品身份；共享 Web 与旧 CLI 从固定 Mobile 发布包引用，避免将兼容入口留在插件外维护第二份业务。
- [ ] Launcher 冷启动保留离线模板；构建 macOS/Windows，运行宿主全部回归与插件包集成测试。

## Task 5：目录读取、安装、备份与回滚

**Files:** Launcher `server/launcher/plugin-catalog.ts`、`server/launcher/plugin-installer.ts`、`server/launcher/controller.ts`、`server/launcher/plugin-runtime.ts`、`server/launcher/plugin-contract.ts`、`tests/server/plugin-catalog.test.ts`、`tests/server/plugin-installer.test.ts`。

**Interfaces:** `PluginCatalog.check(): Promise<PluginUpdate[]>`；`PluginInstaller.install(id,{allowLocalChanges:boolean}): Promise<InstallResult>`。宿主动作 `checkPluginUpdates` 与 `updatePlugin(id,{allowLocalChanges})`；结果包含本地/远端版本、兼容性和源码链接。下载目录源固定为官方 catalog URL，本期不开放任意远端执行源。

- [ ] RED：真实临时 ZIP 覆盖缺失 manifest、错误 ID/version/hash、API 不兼容、降级、路径穿越、符号链接、重复路径；默认包限制 100 MiB、解压后 300 MiB、20,000 文件。
- [ ] RED：更新保留 plugin-data、plugins.json 和访问口令；并发更新串行；本地代码改变须返回明确状态，不默认覆盖。
- [ ] 实现 HTTPS 读取、超时、固定域下载、哈希和归档校验；先 staging 校验，再停止插件、备份旧目录、切换新目录并重载。新目录切换失败时恢复旧目录。
- [ ] RED→GREEN 验证插件加载失败可回滚旧代码；清理或回滚失败保留备份和错误，不重试业务写入。无阻塞问题的用户数据不移入代码备份。
- [ ] 完整测试通过后提交，保留下载失败与更新记录用于诊断，不在日志打印口令。

## Task 6：启动器更新界面与独立升级验收

**Files:** Launcher `launcher/Panel.tsx`、`launcher/tauri-api.ts`、`launcher/preload.cjs`、`launcher/main.cjs`、`server/launcher/sidecar.ts`、`src-tauri/src/main.rs`、相关组件/协议测试、README 和插件 SDK 文档。

**Interfaces:** `LauncherApi.checkPluginUpdates()`、`updatePlugin(id,options)` 对接任务 5；原启用、自动启动、配置页动作保持行为一致。

- [ ] RED：点击检查更新显示本地/最新版本；API 不兼容禁用更新并说明需要升级 Launcher；本地修改须明确确认备份后才覆盖。
- [ ] 接入 Tauri/Electron 固定动作白名单，显示下载、校验、安装、回滚与错误状态；更新一个插件不阻塞其他插件的配置页。
- [ ] 使用真实临时版本包在同一 Launcher 上从 Mobile 旧版本升级到新版；验收 Web、项目、历史、发送接收、审批、运行中引导和 Dots 受控链路。
- [ ] 会话时间独立升级验收，确认 Mobile 无需重启；保留配置与启用状态，更新页面打开时不泄露访问口令。
- [ ] 完整自动测试和用户授权的真实浏览器验证；README 提供独立安装/更新/回滚说明；推送、回读目录与 Release。

## Task 7：最终审查和交付

- [ ] 核对两个仓库 Git 状态、源码唯一归属、固定发布版本和目录真实性；无关草稿未入提交。
- [ ] 根据用户选择的执行方式安排一次最终独立审查，修复影响用户的发现并补 RED→GREEN 回归。
- [ ] 回读两个仓库及正式发布资产；报告仓库地址、各插件版本、实际已验收能力与仍未验证的真实账号行为。
