# macOS 与 Windows 桌面构建和更新

桌面版使用 Tauri 2，版本源为 `desktop-version.json`（初始 `0.1.0`），与 Android/npm 版本独立。工作流 `.github/workflows/build-desktop.yml` 在 main、codex/tauri-desktop-* 或 feat/desktop-cdp-launcher 测试分支的桌面相关路径变更后运行，也可手动运行；手动默认仅构建，不发布。构建矩阵包括 macOS Apple Silicon（aarch64）、macOS Intel（x86_64）与 Windows x64（x86_64-pc-windows-msvc）。macOS 运行环境要求 13.5 或更新版本；Windows 使用 NSIS 安装包，并使用用户已安装的 Node.js。

## 配置更新签名

由维护者在可信机器上执行 `npx tauri signer generate -w <安全目录>/desktop.key` 生成更新密钥。将密钥保存到受保护的备份，不提交私钥或密码到 Git。

在 GitHub 仓库 Actions 设置中配置：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Secret | `TAURI_SIGNING_PRIVATE_KEY` | Tauri 生成的私钥文件内容 |
| Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码；无密码时留空 |
| Variable | `TAURI_UPDATER_PUBLIC_KEY` | 与该私钥匹配的公钥文件内容 |

手动要求正式发布时，缺少私钥或公钥立即失败。main自动构建若尚未配置签名，会明确提示并仅生成安装包；签名配置齐全后自动发布更新频道。仅构建模式产出DMG或NSIS安装包，不生成updater签名资产。构建脚本生成根目录 `tauri.release.conf.json` 作为配置覆盖，只有版本、公钥、更新地址和 `createUpdaterArtifacts` 开关，不含私钥。该文件属于临时产物，不要提交。

## 版本与发布顺序

工作流读取 GitHub 的全部 tags，只考虑 `desktop-vX.Y.Z`。已有桌面版本时取「最高已发布版本的下一个 patch」与 `desktop-version.json` 中较高者；没有记录时采用 `desktop-version.json`。网络/API 失败会中止，不猜测版本。手动版本只接受无前导零的三个整数（例如 `0.1.1`），并要求高于所有已有桌面版本，防止频道回退。测试分支只生成 Actions 构建产物；两种发布入口均只允许 main。

1. Ubuntu verify job 先执行 `npm ci`、`npm run typecheck`、`npm test`，成功后才开始构建矩阵。macOS 打包 DMG、`.app.tar.gz` 更新包及 `.sig`；Windows 打包 NSIS `.exe` 及 `.exe.sig`，Tauri v2 直接复用安装器作为更新包，不生成旧版 ZIP。所有资产名称包含平台与架构，并记录 SHA-256。
2. 三个平台全部成功后，发布 job 验证资产、版本、架构、签名文件和哈希。生成 Tauri 静态索引，平台键为 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64`；任一平台资产缺失时拒绝生成索引。
3. 创建 `desktop-vX.Y.Z` 草稿 Release，上传全部文件，再下载回读验证哈希后转为正式 Release。
4. 最后把 `latest.json` 上传到固定的 `desktop-updates` 预发布 Release；索引 URL 始终指向具体版本的资产，不指向 mobile latest。

所有桌面 Release 都明确设置 `--latest=false`，固定频道为 prerelease，因此不会把 Android 使用的 `/releases/latest` 改成桌面版本。发布流水线串行，不会因新 push 取消正在上传的版本。失败时保留草稿/已发布版本供排查，不删除 tag 或覆盖同版本资产；确认问题后使用新版本重新发布。频道上传失败时已有客户端仍使用之前索引。

收集产物及发布前均使用 `TAURI_UPDATER_PUBLIC_KEY` 对更新包执行密码学验签：兼容 Tauri 的 Minisign 格式，核对 key ID，使用 Node Ed25519 验证 Blake2b-512 预哈希和可信注释的全局签名（也兼容客户端允许的 legacy Ed 格式）。公私钥不匹配、包内容或可信注释被篡改时拒绝发布。发布脚本另外校验清单及所有上传文件哈希，客户端 updater 在安装前再次验证签名。不要把这项校验表述成 Apple 签名或公证。

## Apple 签名与公证边界

目前未配置 Apple Developer 账号、Developer ID 证书或公证凭据。默认流水线没有 Apple codesign/notarization 配置，不能承诺应用已公证或能绕过 Gatekeeper。Tauri 更新签名仅保护应用更新包真实性，与 Apple 签名独立。

取得 Apple 账号后，可按官方 macOS 签名指南，通过 Actions Secrets 配置证书、证书密码、签名身份和 Apple 公证凭据，并在打包步骤传递相应环境变量；完成真实构建后再验证 `codesign` 与 `spctl` 结果。此仓库当前工作流没有自动启用这一可选步骤。

## Windows 安装边界

Windows 构建使用 GitHub `windows-latest` 与 Rust MSVC x64 工具链，全局执行 shell 显式使用 Bash，产物目录通过目标 triple 传递。NSIS 安装器和内置 WebView2 的真实安装、卸载、升级仍需在 Windows 验收。当前未配置 Authenticode 证书，不能声称安装器已获 Windows 代码签名；更新包仍执行独立的 Tauri Minisign 签名验证。

## 本地验证

运行 `npx vitest run tests/server/desktop-release.test.ts`。正式端到端验收还需要真实 GitHub Actions 三个平台产物，以及旧版本应用对固定索引执行下载、签名验证、安装和重启。仅本地单元测试通过不代表发布或应用更新已经实测。

官方参考：[Tauri GitHub Actions](https://v2.tauri.app/distribute/pipelines/github/)、[Updater](https://v2.tauri.app/plugin/updater/)、[macOS 签名](https://v2.tauri.app/distribute/sign/macos/)。

## 当前验证状态（2026-10-12）

本机macOS Apple Silicon应用已构建，约30.39MiB（已移除Node运行时）。656项Vitest通过，11项门控测试跳过；Rust check/test和TypeScript检查通过。Tauri官方CLI临时签名与发布脚本验签互通通过。真实用户Node后台冒烟验证HTTP200及退出端口回收，流水线每个平台均执行该冒烟。Windows x64、Intel macOS和Apple Silicon构建及后台冒烟均已在GitHub Actions通过，三个安装包已下载回读并验证SHA-256。原生UI工具未识别Tauri窗口（cgWindowNotFound），虽窗口日志visible=true，仍不计为界面验收通过。尚未执行正式更新安装或上传远端产物。

## 使用用户 Node.js

启动器不携带 Node 运行时。运行前需安装 Node.js 20 或以上版本，建议使用仍受支持的 LTS。启动器会检查实际可执行文件与版本，优先读取 `CODEX_LAUNCHER_NODE` 指定的绝对路径，其次检查 PATH 和系统常见安装位置（包括 macOS Homebrew、nvm、Volta 和 Windows 官方安装目录）。显式指定路径无效时直接提示，不悄悄换用其他版本。

macOS 从桌面图标启动时可能不继承终端的 nvm PATH，启动器会补查用户 nvm 版本目录。不能找到可用 Node 时，管理窗口显示安装或配置提示，不下载或安装运行时。安装 Node 后重新打开启动器。CI 使用 `actions/setup-node` 的 Node 进行构建和后台冒烟测试。

用户 Node 适配补充验收：Rust 5项测试通过；实际用户 Node v24.18.0 后台冒烟返回 HTTP200并正确关闭端口。新应用包确认没有 `Contents/MacOS/node`。发现过程每个探测最多2秒、总计8秒，避免桌面启动长时间阻塞。

## 启动诊断

macOS 中应用已运行时，`open -a` 只会激活现有窗口，不能依赖它把 `--args` 转交给启动器。需要发送打开Web命令时使用 `open -n -a <应用路径> --args --open-web`，由启动器单实例逻辑转发。

配置目录中的 `launcher-diagnostics.json` 保存 Desktop 连接状态、插件状态、最近RPC/前端错误和脱敏日志，0600原子写入。不包含配置、访问口令或完整请求参数。管理页重启时若工具无法读取原生窗口，可直接读取此文件。读状态不会连接或启动桌面。

2026-10-12 启动修复验证：首次与二次实例共用自动启动动作计划；普通二次实例启动插件，`--no-auto-start`不启动，`--open-web`随后调用Mobile。macOS原生隔离实例验证：不带`-n`未转交参数；带`-n`后普通启动计数1、打开Web计数1，诊断无错误。新增启动参数回归后Rust10项通过，完整Vitest659项通过（11项门控跳过），新包约30.40MiB。隔离测试未连接真实Desktop。

## 首轮远端构建结果

[运行 38194561468](https://github.com/loock-ai/codex-launcher/actions/runs/38194561468) 基于 `a733b96`，版本 `0.1.0`：类型检查、回归、macOS ARM64、macOS x64、Windows x64构建及后台冒烟全部通过。已下载三个安装包并逐个匹配清单SHA-256。Windows NSIS安装包约5.7MB，Apple Silicon DMG约10.8MB。功能分支发布job按规则跳过。Windows安装UI与真实Desktop对话、正式签名发布和更新安装仍未作为此构建验收的一部分。
