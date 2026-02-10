# 搜索与 Query 用法食谱

## TL;DR

- 插件侧：`plugin.search.search(...)` 是“面向 UI 与权限范围”的搜索入口。
- 本地 DB 只读侧：优先用 `remsSearchInfos`（索引元数据）定位，再按需读 `quanta.doc`。
- 本仓库的读取工具链在 `packages/agent-remnote/src/internal/remdb-tools/*`，并由 `packages/agent-remnote` 接线成 CLI。

## 1) 插件侧搜索（面向交互）

适合“在 RemNote 里即刻找内容/定位上下文”：

- 典型 API：`plugin.search.search(richText, { numResults, searchContextRemId, ... })`
- 注意：结果与可访问范围强相关（越权可能拿不到）。

## 2) 本地 DB 只读搜索（面向批处理/汇总）

适合“离线检索/汇总/专题活动”：

- 索引表：`remsSearchInfos`（包含标题/别名/祖先文本等派生信息）
- 全文索引：`remsContents`（FTS5；可能在外部环境不可用）
- 实体表：`quanta`（最终详情还原入口）

只读指南与坑：`docs/remnote/local-db-readonly.md`

## 3) 本仓库工具对应

读取能力库（核心实现）：

- `packages/agent-remnote/src/internal/remdb-tools/searchRemOverview.ts`
- `packages/agent-remnote/src/internal/remdb-tools/executeSearchQuery.ts`

CLI 接线（使用入口）：

- `packages/agent-remnote/src/commands/read/search.ts`
- `packages/agent-remnote/src/commands/read/query.ts`

## 4) Search Portal / Query（高级）

如需理解 RemNote 内部 Query 的结构（用于更接近 UI 行为的检索复刻），看：

- `docs/remnote/database-notes.md`（`Search Portal（u.sp）` 相关章节）
- `docs/proposals/agent-remnote/read-tools-plan.md`（工具层规划与参数语义）

## 5) 本机参考（若存在）

- 搜索食谱：`guides/search-recipes.md`（位于你的本机提炼版目录中，例如 `~/llms.txt/docs/remnote`）
