# Tauri 与桌面发布实施计划

依据已选方案实施，采用 subagent-driven-development 与回归先行，复用当前工作树未提交的插件重构，不回退或混入无关文件。

1. [x] Node sidecar JSON RPC、资源服务、退出回收与集成测试。
2. [x] Tauri Rust 宿主、菜单栏/单实例/资源协议、前端适配与签名更新交互。
3. [x] 独立桌面版本、macOS双架构与Windows x64流水线、签名更新索引及发布验证测试。
4. [x] 用户Node发现与版本检查、依赖资源、构建脚本与现有Electron回退。
5. [ ] 完整测试、Rust编译、受控启动验收、安装包体积和文档。

发布边界：先交付可审查代码及本地产物；仓库Secrets和正式发布需要在具体产物就绪后处理。已有用户请求足以执行上述代码实现。

## 本地验证记录

- Rust check/test、前端与服务端TypeScript通过，已生成macOS Apple Silicon应用（约30.39MiB（用户Node模式））。
- Tauri官方CLI临时签名与发布验签脚本互通验证通过，测试密钥已删除。
- Windows与Intel macOS真实产物待GitHub runner执行，不把命令规划单测算作安装验收。
- 受控启动使用临时配置、--no-auto-start和--no-desktop；Rust日志确认窗口visible=true，但CUA始终cgWindowNotFound，原生UI验收未完成，测试实例已退出。
- 发布密钥尚未配置；正式发布、更新下载安装端到端验收尚未执行。

- 最终Vitest：656通过，11项环境门控测试跳过；Rust测试与两套TypeScript检查通过。
- 用户Node后台冒烟：真实HTTP200、停止端口关闭、shutdown正常退出；该脚本已加入三个CI目标。
- 已请求用户确认将未提交实现推送独立测试分支，触发Windows/Intel/macOS构建；确认前不写远端。

用户现已明确要求提交并推送；将推送当前功能分支，触发仅构建流水线，正式发布仍仅允许main。
