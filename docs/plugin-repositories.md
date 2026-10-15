# 插件仓库、发布与独立更新

## 添加来源

在 Launcher “插件仓库”面板输入公开 GitHub 仓库地址或 `owner/repo`，填写分支后点击“测试并添加”。仓库顶层必须提供 `plugins.json`；测试会读取并校验目录，不下载或执行插件代码。

官方 `loock-ai/codex-launcher-plugins` 首次默认添加，也可编辑、启停或删除。来源存于 `~/.codex-launcher/plugin-repositories.json`；空列表代表用户已删除，不会重置默认仓库。禁用／删除来源不停止或卸载已安装插件。

目前只支持公开 GitHub。私有凭据、GitLab、自定义下载域和后台自动安装未实现。

## 顶层目录

以下为结构示例，`commit` 与 `sha256` 的零值是占位，发布前必须替换为真实值，下载 URL 必须对应已上传的 ZIP。

```json
{
  "schemaVersion": 1,
  "repository": "https://github.com/example/launcher-plugins",
  "plugins": [
    {
      "id": "example-plugin",
      "name": "示例插件",
      "description": "在启动器提供一个示例功能",
      "version": "1.0.0",
      "git": {
        "url": "https://github.com/example/launcher-plugins.git",
        "path": "plugins/example-plugin",
        "ref": "example-plugin-v1.0.0",
        "commit": "0000000000000000000000000000000000000000"
      },
      "compatibility": { "launcherApiVersion": "1", "node": ">=20" },
      "release": {
        "url": "https://github.com/example/launcher-plugins/releases/download/example-plugin-v1.0.0/example-plugin-1.0.0.zip",
        "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
      }
    }
  ]
}
```

| 字段 | 要求 |
| --- | --- |
| `repository` | 匹配所配置的 GitHub 仓库 |
| `id` | 小写字母／数字开头，含字母、数字、下划线或连字符，最多 80 字符；仓库内唯一 |
| `version` | 无前导零的稳定 `X.Y.Z`，版本比较不得超出安全整数范围 |
| `git.url` | 同一仓库，可带 `.git` |
| `git.path` | 安全相对源码路径或 `.` |
| `git.ref` / `commit` | Git ref 与真实 40 位提交 SHA |
| `launcherApiVersion` | 当前宿主支持 `1`；不兼容时禁止安装 |
| `node` | 当前目录契约使用 `>=20` |
| `release.url` | 同一仓库 GitHub Release 的 HTTPS ZIP 地址，无凭据、查询或 hash |
| `sha256` | 实际 ZIP 的 64 位小写 SHA-256 |

官方仓库使用 `<id>-v<version>` tag 和 `<id>-<version>.zip` 文件名；其他仓库可用自己的标签与命名。启动器验证来源及包内容，不要求第三方采用官方的 tag 前缀。Git 信息用于追溯源码，安装时不 git clone 或执行构建。

## ZIP 运行包

ZIP 根目录直接包含 `manifest.json` 及其入口，不再包一层插件文件夹：

```text
manifest.json
main.cjs          # 按插件声明选择
ui/index.html
ui/app.js
inject.js
web/index.html    # Mobile 的浏览器资源
web/assets/
```

目录项与 manifest 的 ID、版本和 API 必须一致；至少有一个 `main/ui/desktop` 入口。路径不得逃逸、包含符号链接、重复名称或加密文件。下载最大 100 MiB，解压总量最大 300 MiB、20,000 个条目。后台必须携带自己的运行依赖，用户电脑不执行 npm install。

## 官方插件开发与发布

```bash
git clone https://github.com/loock-ai/codex-launcher-plugins.git
cd codex-launcher-plugins
npm ci
npm test
npm run typecheck
npm run build
```

- 会话时间：`plugins/desktop-thread-time/`。
- Mobile：manifest 与配置页在 `plugins/mobile/`，业务源码在 `plugins/mobile/source/`。后台入口源码是 `source/plugins/mobile/main.ts`，前端在 `source/src/`。
- Mobile 的 esbuild CJS 包包含后台业务和 JS 库；Vite 生成 Web 资源。发布包另附兼容构建源码。
- 新插件放入 `plugins/<id>/`，提供 manifest 和可运行入口；通用打包器支持其他目录。插件的后台依赖须自行内联或完整携带。

提高目标插件 manifest 版本、提交到 main 后，运行仓库的 **Release independent plugin** 工作流；输入目标 ID。维护者也可在该仓库运行：

```bash
node scripts/release-plugin.mjs desktop-thread-time
node scripts/release-plugin.mjs mobile
```

脚本测试与打包、生成 ZIP/校验文件，上传草稿并下载回读验证后正式发布，最后更新本地顶层目录。工作流继续提交推送目录；本地执行时维护者需审阅并提交推送 `plugins.json`。不要先写入尚不存在的资产地址，不覆盖已发布的同版本包；未知上传结果先查询原状态。

## 更新与来源绑定

检查更新只读取所有启用仓库的目录，一个来源失效不会阻止其他来源。安装或更新单个插件时才下载 ZIP。

未安装的同名 ID 来自多个仓库时，必须明确选择来源；目录只能安装一个同 ID 插件。成功后来源和代码哈希记入 `plugin-installations.json`，后续只能从原来源更新。移除原来源后不会转向其他仓库同名插件。旧版安装记录归属原官方仓库。

目标目录必须与 ID 一致，且不能被其他插件占用。本地修改或未登记来源的现有代码需要明确保留备份后更新。更新等待旧宿主请求清理，备份代码、切换目标目录并重载；不停止其他插件。失败恢复代码及加载／自启／删除策略。

## 删除、备份与配置

删除停止目标并备份代码，清除其安装来源及启停策略，保留 `plugin-data/<id>/`。`plugins.json.removed` 防止内置模板重启再安装；主动从仓库重装后清除该记录，重装失败保留删除状态。

备份在 `plugin-backups/<id>/`，不是配置备份。自动回滚处理安装或删除失败；当前没有一键选择历史版本的手动回滚界面。

仓库内容需可信。SHA-256 用于完整性校验，不是独立代码签名；后台 Node 插件及桌面脚本有各自执行环境，进程和 iframe 隔离不代表恶意插件沙箱。能力契约见 [插件 SDK](launcher-plugin-sdk.md)。
