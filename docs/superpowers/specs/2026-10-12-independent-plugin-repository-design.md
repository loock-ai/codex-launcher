# 独立插件仓库与更新目录设计

状态：待用户审阅；尚未创建远端仓库或执行源码拆分。

## 目标与边界

新建 `loock-ai/codex-launcher-plugins`，统一维护会话时间、Mobile 和后续插件。顶层提供启动器可读取的插件目录，包含描述、版本、Git 地址及发布包信息。Mobile 前端、网关业务与运行依赖随插件发布，常规升级不要求重建 Launcher；依赖新版宿主 API 时明确提示升级启动器。

现有桌面目录迁移修改仍在 Launcher 工作区中，实施时单独提交，不与插件拆分混为一笔。安卓产品名称、包名与 npm CLI 名称保留；迁移其共享 Web 源码时同步调整构建来源，保持既有客户端发布方式，不改产品身份。

## 两个仓库的职责

- `codex-launcher`：Tauri 外壳、插件管理、插件配置存储、安装更新、共享 DesktopService/CDP 连接及稳定宿主 API。
- `codex-launcher-plugins`：插件源码、配置页面、业务资源、独立打包、版本与发布流水线。Mobile 携带 Web、网关、Dots 业务适配和自身运行依赖；会话时间携带注入脚本及 manifest。
- 插件不得读取 Launcher 仓库的相对源码或依赖其 npm-dist 路径。宿主通过已有 `ctx.host.call` 和事件订阅提供共享能力。
- 跨仓库共享代码只能存在于一处；Mobile 所属代码移到插件仓库，Launcher 的兼容入口通过明确版本的发布包使用，不保留两套持续维护的副本。

## 插件仓库结构

```text
codex-launcher-plugins/
├── README.md
├── plugins.json                 # 可读取的插件目录
├── schemas/plugins.schema.json
├── plugins/
│   ├── desktop-thread-time/
│   │   ├── manifest.json
│   │   └── inject.js
│   └── mobile/
│       ├── manifest.json
│       ├── main.ts
│       ├── ui/
│       ├── web-src/              # Web 前端源码
│       └── server/               # 插件业务后台
├── scripts/                     # 打包、目录校验和发布
└── .github/workflows/           # 按插件发布
```

## 顶层目录格式

下例展示字段契约；实际发布时填写真实提交、包地址和 SHA-256，不发布占位值。

```json
{
  "schemaVersion": 1,
  "repository": "https://github.com/loock-ai/codex-launcher-plugins",
  "plugins": [
    {
      "id": "desktop-thread-time",
      "name": "会话时间",
      "description": "在桌面会话列表显示最近活动时间",
      "version": "1.0.2",
      "git": {
        "url": "https://github.com/loock-ai/codex-launcher-plugins.git",
        "path": "plugins/desktop-thread-time",
        "ref": "desktop-thread-time-v1.0.2",
        "commit": "发布时写入真实提交 SHA"
      },
      "compatibility": {"launcherApiVersion": "1", "node": ">=20"},
      "release": {
        "url": "发布时写入不可变版本的 Release 包地址",
        "sha256": "发布时写入包的 SHA-256"
      }
    }
  ]
}
```

Mobile 使用相同字段。目录中的版本必须和包内 manifest 一致；schema 拒绝重复 ID、非法 SemVer、缺失包信息和非法路径。`git` 用于查看源码和追踪发布来源；启动器默认下载预构建发布包，不在用户电脑上 git pull、npm install 或执行构建脚本。

## 发布和更新

1. 插件使用独立 tag，例如 `mobile-v1.0.1`、`desktop-thread-time-v1.0.3`。仅修改一个插件时不提升其他插件版本。
2. CI 构建自包含插件包，验证包在没有 Launcher node_modules 的条件下可加载，生成 SHA-256，发布不可变 Release 资产。
3. 验证远端资产后更新顶层 `plugins.json`；目录版本不先于可下载的实际资产。失败时不更新目录。
4. Launcher 提供“检查更新”和每个插件的“更新”操作，显示本地与远端版本、描述及源仓库链接。本期不自动后台安装更新。
5. 下载至临时目录，校验包哈希、manifest ID/版本、入口路径和宿主 API；拒绝路径穿越、符号链接及超限包。默认只信任配置的官方插件仓库，包哈希用于完整性检查，不宣称其等同于独立签名认证。
6. 安装前停止目标插件、备份旧代码目录，再切换新目录并重新加载；插件更新不修改 `plugins.json` 开关，也不触碰 `plugin-data/<id>/`、共享配置及用户访问口令。
7. 本地插件代码有修改时，不静默覆盖，明确显示并保留备份。加载失败时回滚代码目录，保留错误供诊断，不重放发送消息或审批等业务操作。

## 本机结构

```text
~/.codex-launcher/
├── config.json
├── plugins.json                  # 本地启用/自动启动策略，与远端目录不同
├── plugin-data/<id>/config.json
├── plugins/<id>/                 # 已安装代码
└── plugin-backups/<id>/<version>/
```

首次安装可随 Launcher 附带已发布插件包，保证无需联网也能打开配置界面；后续由插件目录独立更新。Launcher 构建固定引用插件发布版本和哈希，不拉取浮动 main。

## 验收条件

- 新仓库真实创建，两个插件源码及可运行发布包均可追溯。
- 顶层目录可解析、通过 schema，版本和实际资产一致。
- 新增第三个插件只需添加插件目录和目录项，无需写 Launcher 产品分支。
- 同一 Launcher 上独立升级 Mobile 后，手机 Web 和插件配置页面使用新资源，项目、历史、发送接收、审批等既有回归通过。
- 会话时间升级不影响 Mobile；配置、开关、访问口令和本地修改均按约定保留。
- 下载失败、哈希不符、API 不兼容及加载失败不损坏现有安装，支持回滚。

## 建议实施阶段

1. 提交已验证的隐藏配置目录迁移；建立新仓库、目录 schema 与独立打包发布。
2. 把 Launcher 内置插件来源切换为固定版本发布包，理清 Mobile 业务边界及原客户端构建来源。
3. 接入目录读取、更新界面、安装校验、代码备份和回滚；进行独立升级验收。

用户审阅此设计后编写详细实施计划，再进入跨仓库改动。
