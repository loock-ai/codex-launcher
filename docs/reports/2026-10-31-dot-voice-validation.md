# Dot 网页语音开发与验证记录

## 原 Dots 对话页已在本机启用（最新）

用户确认原页面语音可用后，已按要求清理独立验收页：19879 服务关闭，对应 `.cache/dot-voice-manual/` 的服务脚本、页面源文件和构建资源已删除。现仅使用原 Mobile 的 19877 网关及 `#dots` 对话页；原页面语音功能、自动化回归测试、验收记录和回滚备份保留。下文独立入口仅为历史过程记录，不再可访问。

用户明确要求在原对话页面使用语音，已将完整修复版 Mobile 插件启用到实际运行目录 `/Users/loock/.codex-launcher/plugins/mobile/`，并替换本机 Launcher 资源中的三个宿主信令脚本。只重启 Launcher，ChatGPT 主进程保持不变；原网关继续使用 **19877**，配置、访问口令、自启策略和安装来源记录经部署前后 JSON 比较保持一致。

已在原完整 Mobile 应用的 `#dots` 页面验证，而非独立验收页：网页出现通话控件，`active=true`；start、attach、stop 均为 HTTP 200；WebRTC 和 ICE 均 connected；真实音频 RTP 发送 8746 字节、接收 17123 字节。测试使用静音模拟麦克风，挂断已确认，用户可在已打开的原 Edge 对话页继续人工听说。原页头部截图 `/tmp/dot-original-page-voice.png`；验收日志 `/tmp/dot-original-page-real-result.log`。

重新构建、448 项 Mobile 回归及其他插件测试通过。原 DotsPage 的电话入口、原消息区和输入框共用同一插件与宿主连接，没有用独立页面替代对话页面。

回滚备份：`/Users/loock/.codex-launcher/plugin-backups/dot-voice-original-page/20261031-173406/`，包含旧 Mobile 全量代码、宿主三个原脚本及受保护配置。此次为本机测试热修复，Mobile 清单仍为 1.1.0，未发布正式版本；保留安装来源记录以便识别本地修改。其他电脑未变更。

## 真实网页拨号修复与验收（最新）

用户人工拨号后遇到“已有通话连接中、进行中或待清理”。已查明首次创建在桌面发送前失败：通用代理对所有 POST 强制增加 `X-OpenAI-Attach-DeviceCheck-Token: 1`，而语音 URL 不在该标记适用范围内。桌面明确返回 `status=400`、`responseStatus=null`、`Refusing to attach DeviceCheck token to unexpected URL`。原实现将该发送前拒绝误判为创建结果未知，因此残留的保护记录阻止后续拨号。

已修复：语音 create/attach/stop 沿用原生客户端产生的 headers，不再额外强制该标记；仅对上述精确、已核对的发送前拒绝按明确失败处理，其他无响应错误仍保留未知结果语义。补充真实错误形态回归，观察失败后修复通过；宿主相关 25 项、语音服务和界面 16 项测试通过，独立只读复核无重要遗漏。

已直接在本机网页连接真实 Dot，而非受控替代服务。首次成功后确认服务端 stop=200、活动通话已清除；随后重启独立测试服务，移除所有临时诊断覆盖，再次用正式修复源码验收成功：

- `/api/dots/voice/start`、`attach` 和 `stop` 均返回 HTTP 200。
- 网页显示实际通话控件，`active=true`，无错误；WebRTC `connectionState=connected`、`iceConnectionState=connected`。
- 实际音频 RTP：发送 8291 字节、接收 17553 字节，均来自真实语音服务连接。
- 本轮使用静音模拟麦克风，未采集用户现场声音；实体麦克风、扬声器的人工听说仍由用户确认。

验收日志 `/tmp/dot-real-voice-acceptance.log`；真实网页通话截图 `/tmp/dot-real-web-call.png`。调试检查端口已关闭，原生 ChatGPT 未为此重启。测试服务继续在 `http://127.0.0.1:19879/` 运行，供用户人工验证，已清除已确认发送前失败的旧阻塞记录。未替换正式 Launcher 或插件，也未向 Dot 发送文字任务。

## 人工测试入口更新

用户随后要求打开启动器并连接桌面。已打开本机 Codex Launcher，原生“桌面”页经界面检查显示“已连接 · 2 个插件使用中”；ChatGPT 已监听回环 9333，不需要再次重启。当前桌面版本为 `26.1027.30824`，因资源计时记录不包含原生 API 模块，新增已静态及运行时核对的分离模块兼容映射，并通过先失败后成功的回归测试（宿主相关 15 项通过）。

独立测试服务已重载本次修复：真实 `/api/dots/status` 返回 `available=true`、`capabilities.voice=true`；真实 Dot 列表 HTTP 200，返回 1 个具有消息房间的可用 Dot。测试页已准备好，刷新或重新打开后由用户手动点击电话按钮。未代用户拨号、发送文字或确认双向声音；启动器安装包及正式插件没有替换。

2026-10-31，用户要求“开启测试”并指定人工验证后，已启动独立本机测试服务：`http://127.0.0.1:19879/`。服务直接运行本次宿主信令和插件语音源码，不替换已安装 Launcher、不改原端口和配置。运行文件与 PID 位于独立插件仓库 `.cache/dot-voice-manual/`。

首页、脚本、真实桌面状态接口均返回 200；未鉴权接口返回 403。启动时真实桌面状态为未连接，语音能力为 false，没有调用真实 Dot 或模拟状态为已连接。重新运行宿主 14 项、语音服务与界面 16 项测试通过。

请在本机 Chrome/Edge 打开上述链接，保存工作并退出 ChatGPT，再点击“启动桌面桥接”。该按钮只会在应用已经退出时以 9333 桥接端口启动应用，不会强制终止当前任务。连接后可选择真实 Dot 并点击电话按钮，自行允许麦克风、听说、静音和挂断。服务只监听本机回环地址，不能直接作为手机访问链接。

以下为本轮开发完成时的原始验证记录；真实通话尚待用户人工验收。

## 1. 当前结果

最小功能已在源码实现，插件可构建。受控 Chromium 双向音频通路通过：实际网页电话按钮发起 WebRTC，双方音频 RTP 字节增长，静音后发送音轨禁用，挂断后两端连接关闭且本地音轨结束。测试使用模拟麦克风和受控 WebRTC 对端，未访问真实 Dot；最终测试未放宽 Chromium 自动播放策略。

**真实 Dot 拨号和手机实体麦克风/扬声器尚未验收，未部署到正在运行的 Launcher。** 本机 ChatGPT 正在运行，但没有可用的 CDP 监听；本轮未重启应用、修改三台电脑配置、安装测试插件、推送或发布版本。

## 2. 已实现

1. Launcher 仅放行指定 Dot 的创建、关联、挂断通话路径；保留 SDP 文本和 location/root-thread 响应头，不传回其他响应头。状态新增 `voiceSignaling` 能力。
2. Mobile 新增 `/api/dots/voice/start`、`attach`、`heartbeat`、`stop`，沿用网关鉴权。网页不能提供任意原生通话 ID；请求绑定 Dot、账户和随机 requestId。
3. 一次创建不自动重发；同 ID 输入不一致拒绝，重放检查账户与生命周期；创建结果未知时阻止再次拨号。已知通话通过心跳租约、取消后的补偿挂断和退出清理回收。
4. 网页新增语音入口、连接状态、计时、静音与挂断。切换 Dot/设备、退出页面、连接失败时关闭本地音轨；服务端挂断未确认会明确提示。
5. 320 像素窄屏下控件保持在可见范围。旧宿主未提供能力时不显示拨号入口；非安全上下文不能使用麦克风。

独立插件源码在 `/Users/loock/myFile/codex-launcher-plugins/plugins/mobile/source/`。Launcher 的 types/adapter 等兼容副本是由插件包提供的文件；已将新增语音模块纳入 `compatibility-files.json`。上线必须同时具备新的宿主信令实现和插件，不能只升级网页资源。

## 3. 验证证据

| 检查 | 结果 |
| --- | --- |
| 插件完整 `npm test` | Node 测试 15 项、CI 测试 6 项、Mobile 测试 448 项通过；浏览器专用测试默认跳过 |
| 宿主 Dots、UI、DesktopService 回归 | 101 项通过；原有 CDP fixture 按环境跳过 |
| 最终布局、语音、附件、多语言专项 | 47 项通过 |
| 受控 Chromium WebRTC 测试显式启用 | 1 项通过；涵盖双端 RTP、静音、挂断、音轨释放、鉴权和 320px 控件边界 |
| 插件前端与相关服务端严格类型检查、宿主服务端类型检查 | 通过 |
| `node scripts/build-plugin.mjs mobile` | 通过，产物在插件仓库 `dist/mobile/`；Vite 有现有大块体积提示 |
| 双仓库 `git diff --check` | 通过 |
| 独立只读审查 | 发现并修复旧通话回调覆盖新通话、旧请求跨账户重放；复核无新的重要问题 |

关键测试：插件 `tests/server/dots-voice.test.ts`、`tests/ui/dots-voice.test.ts`、`tests/server/dots-voice-browser.integration.test.ts`；宿主 `tests/server/dots-desktop-contract.test.ts` 和 `dots-identifiers.test.ts`。新增用例先观察失败再实现；浏览器测试作为跨组件验收另外运行。

浏览器测试复现（在独立插件仓库执行；需要现有 Playwright Chromium）：

```sh
node scripts/build-plugin.mjs mobile
RUN_VOICE_BROWSER_TEST=1 npm run test:mobile -- tests/server/dots-voice-browser.integration.test.ts
```

本机 Playwright 默认浏览器修订版尚未下载，因此本轮用 `VOICE_TEST_BROWSER` 指定已安装的 Chromium headless shell 1243，没有安装浏览器或依赖。最终截图：`/tmp/dot-voice-browser-active.png`。

安装包 `26.1023.51421` 的当前脚本静态包含创建、attach、stop 和 `oai-events` 数据通道。该证据只说明接口代码仍存在，不能替代真实账户验收。

## 4. 后续真实验收

1. 经用户确认后，先在本机备份并启用宿主与插件测试版本，准备可访问的桌面桥接；如需重启 ChatGPT，先告知会中断当前桌面连接。暂不改其他两台电脑。
2. 通过本机安全地址使用当前已登录账户，确认原生创建只发生一次、关联成功、WebRTC 与数据通道接通，测试后核对挂断。
3. 手机通过可信 HTTPS 地址进入网页，人工允许麦克风，实际听说核对双方声音；检查静音、挂断、切换页面、断网和再次拨号。Chromium 模拟手机 UA 不能证明 Safari 或手机系统的后台行为。

首版仅支持前台通话。若创建结果未知且没有通话 ID，应先在 ChatGPT 核对，不自动重拨；若桌面账户切换导致旧通话无法清理，需要在原账户核对通话。未承诺锁屏保活、来电、转写或正式公开 API 的稳定性。
