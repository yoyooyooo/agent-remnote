# RemNote · 概念与用法（本仓库）

本目录用于沉淀与本仓库相关的 RemNote 概念、读写边界、以及插件开发要点（面向人类与自动化代理）。

## 优先资料源（建议阅读顺序）

1. 本仓库 RemNote 文档：
   - `docs/remnote/app-overview.md`：产品概念与术语
   - `docs/remnote/database-notes.md`：本地 SQLite 结构笔记（只读视角）
   - `docs/remnote/search-index-investigation.md`：本地搜索索引层抽样调查（结构/索引/触发器/FTS 限制）
   - `docs/remnote/plugin-sdk.md`：插件 SDK 要点（本仓库落地版）
   - `docs/remnote/local-db-readonly.md`：本地 DB 只读读取指南（本仓库落地版）
2. 你的本机提炼版（若存在）：`~/llms.txt/docs/remnote`（Windows：`%USERPROFILE%\\llms.txt\\docs\\remnote`）
3. 官方插件文档：https://plugins.remnote.com/
4. 类型签名（不够用再看）：`node_modules/@remnote/plugin-sdk/**` 与 TypeDoc

## 最短阅读路径（理解本仓库的 RemNote 部分）

1. 红线与架构：`docs/ssot/00-principles.md`、`docs/ssot/03-architecture-guidance.md`
2. RemNote 概念：`docs/remnote/app-overview.md`
3. 插件 SDK 要点：`docs/remnote/plugin-sdk.md`
4. 本地 DB 只读：`docs/remnote/local-db-readonly.md`（细节见 `docs/remnote/database-notes.md`）
5. 写入协议与队列：
   - `docs/ssot/agent-remnote/queue-schema.md`
   - `docs/ssot/agent-remnote/ws-bridge-protocol.md`
   - `docs/ssot/agent-remnote/tools-write.md`

## 用法食谱（渐进式披露）

每个食谱尽量只讲“该用什么、怎么用、常见坑”，更深细节再指向权威文档或代码锚点：

- 权限（Scope/Level）：`docs/remnote/guides/permissions.md`
- 选区与事件：`docs/remnote/guides/selection-and-events.md`
- 富文本（RichTextInterface）：`docs/remnote/guides/richtext.md`
- Powerup / Property / Table：`docs/remnote/guides/powerups-properties-tables.md`
- 搜索与 Query：`docs/remnote/guides/search-and-query.md`
- 设置与存储：`docs/remnote/guides/settings-and-storage.md`
- 命令与消息：`docs/remnote/guides/commands-and-messaging.md`
- Markdown 导入：`docs/remnote/guides/markdown-import.md`
- 排障：`docs/remnote/guides/troubleshooting.md`

## 概念速查（跨 UI / 插件 / DB）

- Rem：一切内容单元；树状结构。
- Page / Document / Folder：顶层承载与组织方式（Page 本质也是 Rem）。
- Daily Document：每日笔记页面（用于快速捕捉）。
- Rem Reference：`[[` / `@` 插入对某个 Rem 的引用。
- Portal：`((` 插入子树投影（双向同步）。
- Tag：语义标签；可演进为 Powerup/属性/表格。
- Powerup：标签 + 属性的“业务模型”；用于结构化建模（插件侧 `registerPowerup`）。
- Property / Table：以 Tag/Powerup 为根的结构化字段与集合视图（行是被标记 Rem，列是属性 Rem）。
- RichTextInterface：富文本结构；插件写入需用 `plugin.richText` Builder 或 SDK 工具构造。
- Widget：插件 UI 注入点；通过 `WidgetLocation` 决定渲染位置。
- Permissions：Scope（范围）+ Level（能力）；越权访问通常返回 `undefined`（需要判空）。

## 与本仓库的“读/写”映射

- 读（只读本地 DB）：由 `packages/agent-remnote/src/internal/remdb-tools/**` 提供解析/查询工具，`packages/agent-remnote` 以 CLI 形式接线。
- 写（安全落库）：由「队列 SQLite → WS bridge → RemNote 插件（官方 SDK）执行」组成；插件只负责执行与回执。
