# 新版桌面远程主机目录兼容修复

## 已观察到的原因

桌面26.1016.51333仍提供getSharedObjectSnapshotValue，但remote_ssh_connections、remote_control_connections、remote_wsl_connections均undefined。真实AppHost新增remoteConnections.catalog.subscribe入口，首个快照包含ssh、wsl、remoteControl。catalog.read为原生实例字段，不能通过RPC调用。

## 实施与验收

- [x] 新版使用已加载共享模块的接口检测，不绑定桌面版本、文件hash或导出名。
- [x] 旧共享数组仍可用时保留旧路径；保留autoConnect过滤、去重及凭据脱敏。
- [x] 单次订阅读取快照，回收正常、超时和迟到句柄；接口不可用时不伪装成只有本机。
- [x] 26项相关测试、类型检查与后端编译通过；真实CDP返回本机及两台已启用的远程主机。
- [x] 备份本机已安装桥接模块，只替换主机读取函数，重启启动器。
- [x] 验证实际Web网关的主机列表和桌面连接。暂不发布新安装包。

完整ASAR的REA分析因一个无关解包native.node摘要不匹配而未完成；主机入口结论来自限定范围的JS源码核对及实际CDP接口调用，不将完整安装包当成已校验。

## 最终验证

本机安装模块已备份并应用兼容函数，已重启Launcher，实际/api/desktop/hosts返回本机、macmini及C4M479YXK7，/api/status connected=true；两个插件running。全量674通过、11跳过；源码及安装模块分别验证。不修改远程主机自动连接策略，不发布安装包，不覆盖既有文档草稿。
