# Dots 新版桌面通道恢复

沿用已确认的计划、TDD与部署验收流程，修复用户截图中的26.1021.31345版本拒绝。

- [x] 定位版本白名单、资源和导出变动；确认新版服务在app-shared、原生API在app-initial。
- [x] 先新增未知版本、分离模块、通用API拒绝与歧义回归，观察6项失败；实现能力发现后通过。
- [x] 保留账号绑定、预期身份、请求取消、不重放未知写入及原生设备请求头。
- [x] 源码真实CDP读取验证：状态可用，1个Dot，20条历史，user/assistant角色齐全。
- [x] 全量702通过、11跳过；类型检查与服务端编译通过。
- [x] 独立审查和受控Electron消息/附件回归。
- [x] 备份运行包后安装相同编译脚本热修复，重启启动器；不重启桌面，保留配置和口令。
- [x] 浏览器验收与两台远端HTTP验收，记录未发布范围。

REA对6MB共享模块分析超时，未取得静态分析Evidence；改用提取包内目标JS的局部检查和真实CDP只读运行时核对。运行时验证不导出身份或消息正文。

## 部署记录

编译脚本SHA-256：5759f883fc3b63fb440b22e439089aa9f28a80937e8ee57a0a6920289d57b2a2；三个实际运行包一致。仅替换宿主npm-dist/server/dots/desktop-script.js并重启启动器，不修改插件代码或桌面进程。基础版本未变，此次为本机及远端热修复，未发布新正式包。

- 本机0.1.3-dev.1，当前实际配置仍在Library/Application Support/codex-mobile，备份plugin-backups/dots-contract/20261026-230722。
- macmini0.1.3，配置~/.codex-launcher，备份plugin-backups/dots-contract/20261026-230808。
- Cindy0.1.3，配置~/.codex-launcher，备份plugin-backups/dots-contract/20261026-230804。
- 各机token与端口核对不变，鉴权dots/status、dots/list、dots/messages均200，available=true，1个Dot与20条消息，包含user和assistant。
- 原生Dots API请求已真实读取验证，发送和附件上传只在受控Electron验证；未向用户真实Dot发送测试消息。

- 真实Edge通过Linghou复用现有CodexRemote标签进入Dots：顶部dot、已连接，历史正文显示，版本未验证错误消失。截图 /tmp/dots-current-edge.jpg；未发送消息/文件/审批。
