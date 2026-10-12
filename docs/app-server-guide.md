# 原 app-server 与移动端构建指南

桌面同步推荐使用 [菜单栏启动器](../README.md)。本页保留独立 app-server、环境变量、开发与移动端构建说明。

### 原 app-server 模式

以下 npm CLI 步骤运行独立 app-server；要控制桌面正在运行的会话，参见 [桌面启动器](desktop-launcher.md)。

#### 1. 安装网关

要求 Node.js 20 或更高版本，并确保本机已有可用的 `codex` CLI。

```bash
npm install -g codex-mobile
```

只在当前电脑访问：

```bash
codex-mobile start
```

默认打开 [http://127.0.0.1:18766](http://127.0.0.1:18766)。

#### 2. 允许手机通过局域网连接

非回环监听必须配置访问口令：

```bash
HOST=0.0.0.0 \
CODEX_MOBILE_TOKEN='<随机口令>' \
codex-mobile start
```

在另一个终端显示连接地址和二维码：

```bash
codex-mobile auth
```

手机扫码后即可打开：

```text
http://<电脑局域网IP>:18766/?token=<随机口令>
```

纯文本脚本可使用 `codex-mobile auth --plain`。最近一次成功启动的实际端口和访问口令
保存在 `~/.codex-mobile/runtime.json`，文件权限为 `0600`。

#### 3. 添加更多设备

在另一台 Mac 上用不同口令启动网关，然后在 Codex Mobile 的设备管理中输入其完整
地址。客户端会检查 `/api/host`，完成一次 WebSocket `initialize`，验证成功后保存
设备。

一个客户端最多保存 8 台设备，并可同时维持所有已启用设备的连接。

## 运行模式

### Managed（`start` 默认）

网关自动启动并管理一个仅监听回环地址的 app-server：

```bash
CODEX_APP_SERVER_MODE=managed \
CODEX_APP_SERVER_PORT=18765 \
codex-mobile start
```

原始 app-server 不应监听局域网地址，只有网关对外提供服务。

### External

连接已经运行的 app-server，网关不管理其生命周期：

```bash
CODEX_APP_SERVER_MODE=external \
CODEX_APP_SERVER_URL=ws://127.0.0.1:18765 \
codex-mobile start
```

### Gateway-only

移动 App 已内置前端时，后端可以只提供控制面和 WebSocket：

```bash
CODEX_MOBILE_SERVE_STATIC=false codex-mobile start
```

此时网关根路径返回 `404`，`/api/*` 和 `/ws` 仍可使用。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 网关监听地址；局域网访问使用 `0.0.0.0` |
| `PORT` | `18766` | 网关端口，也可通过 `start --port` 指定 |
| `CODEX_MOBILE_TOKEN` | 空 | 访问口令；非回环监听时必填 |
| `CODEX_MOBILE_HOST_ID` | 自动生成 | 稳定的设备标识 |
| `CODEX_MOBILE_HOST_NAME` | 主机名 | 客户端展示的设备名称 |
| `CODEX_MOBILE_UPLOAD_DIR` | `~/.codex/codex-mobile-uploads` | 图片以外附件的上传目录 |
| `CODEX_MOBILE_SERVE_STATIC` | `true` | 设为 `false` 启用 gateway-only |
| `CODEX_APP_SERVER_MODE` | `managed` | `managed` 或 `external` |
| `CODEX_APP_SERVER_PORT` | `18765` | Managed app-server 回环端口 |
| `CODEX_APP_SERVER_URL` | `ws://127.0.0.1:18765` | External 模式的上游地址 |
| `CODEX_MOBILE_CDP_URL` | `http://127.0.0.1:9333` | `control` 模式的本机桌面 CDP 地址 |
| `CODEX_HOME` | `~/.codex` | Codex 状态目录 |

内置 App 可能发送 `Origin: null` 或其他本地页面 Origin。网关允许跨来源访问控制面，
但 HTTP API 和 WebSocket 始终需要正确 Token。

## 从源码开发

```bash
git clone https://github.com/loock-ai/codex-launcher.git
cd codex-launcher
npm install
npm run dev
```

开发模式同时运行：

- Vite：`http://0.0.0.0:5173`，提供前端和 HMR；
- 网关：`http://0.0.0.0:18766`；
- Managed app-server：`ws://127.0.0.1:18765`。

`npm run dev` 默认读取：

```text
~/Library/Application Support/CodexMobileWeb/gateway.env
```

示例配置：

```bash
export HOST='0.0.0.0'
export PORT='18766'
export CODEX_APP_SERVER_MODE='managed'
export CODEX_APP_SERVER_PORT='18765'
export CODEX_MOBILE_HOST_ID='macbook-pro'
export CODEX_MOBILE_HOST_NAME='MacBook Pro'
export CODEX_MOBILE_SERVE_STATIC='false'
export CODEX_MOBILE_TOKEN='<独立口令>'
```

### 验证

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## 移动端构建

[最新 GitHub Release](https://github.com/loock-ai/codex-launcher/releases/latest) 提供：

- Android APK 及 SHA-256 校验文件；
- 未签名 iOS IPA 及 SHA-256 校验文件。

Android App 会检查正式 Release，发现新版本后由用户确认下载，校验成功后调起系统
安装器。首次使用需要在 Android 系统中允许 Codex Mobile 安装未知应用，App 不支持
静默安装。

iOS IPA 未签名，安装到真实设备或上传 TestFlight 前仍需使用 Apple Developer 证书
签名。

仓库使用固定提交的 PakePlus Android/iOS 项目作为原生容器，并把当前 `dist/` 静态
资源内置到 App。构建产物不包含局域网 IP、网关 Token 或其他私人配置。

发布流程：

- `main` 的应用相关代码变化会触发 Android、iOS 构建和 GitHub Release；
- npm 包只在网关、CLI 或包配置变化时随同发布，也可在手动工作流中显式启用；
- Android、iOS 与同次发布的 npm 包共用一个解析后的版本号。

相关工作流：

- [build-android.yml](../.github/workflows/build-android.yml)
- [build-ios.yml](../.github/workflows/build-ios.yml)
- [publish-npm.yml](../.github/workflows/publish-npm.yml)
