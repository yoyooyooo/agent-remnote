# RemNote 本地数据库（SQLite）只读指南（本仓库落地版）

## 红线（MUST）

- 禁止直接修改 RemNote 官方数据库（`remnote.db`）。
- 读取只做离线分析/检索/汇总；写入必须走「队列 SQLite → WS → 插件 SDK」链路。

权威说明与细节见：`docs/remnote/database-notes.md`

索引层抽样调查（结构/索引/触发器/FTS 限制）：`docs/remnote/search-index-investigation.md`

## 你会遇到的三个层面

1. UI/概念层：Rem / Page / Tag / Portal / Daily Doc（见 `docs/remnote/app-overview.md`）
2. 插件 API 层：`@remnote/plugin-sdk`（写入与安全权限由宿主管理）
3. 本地 DB 层：`remnote.db`（大量派生表、触发器、同步与索引机制）

本仓库读取工具的策略是：**优先使用搜索索引表定位 Rem → 再按需读取 `quanta.doc` 深入解析**。

## 核心表（只读视角）

- `quanta`：Rem 的核心实体（`_id` + `doc` JSON）；绝大多数结构最终都能回落到这里。
- `remsSearchInfos`：搜索索引（包含标题/别名/父子关系/祖先文本等派生信息）；适合作“快速定位”入口。
- `remsContents`（FTS5）：全文索引（依赖 RemNote 自带 tokenizer；外部环境可能无法复刻）。
- `pendingRecomputeRems`：派生数据重建队列（由宿主管理）；只读即可。
- `staged_changes_*` / `sync*`：同步相关增量与日志（只读排障用）。

## 读取策略（推荐）

1. 搜索/定位：优先查 `remsSearchInfos`（必要时再尝试 `remsContents`）。
2. 详情/还原：读 `quanta.doc`，并按 `key`（含引用片段）做必要的引用展开。
3. 层级/子树：根据 `parent` 与排序键（如 `f`）恢复结构；对大树要分页/限深。
4. 表格/属性：先定位 Tag/Powerup Rem，再解析属性 Rem 与 `tp`/属性值的存储结构（细节见 `docs/remnote/database-notes.md`）。

## 常见坑（只读也会踩）

- FTS 不可用：`remsContents` 依赖 RemNote 的自定义 tokenizer；外部 sqlite 环境可能无法 `MATCH`，需要回退到 `remsSearchInfos`/`quanta` 的 JSON 字段匹配。
- DB 占用/锁：桌面端正在写入或同步时可能无法稳定读取；必要时改读备份/副本（只读）。
- 引用链：`doc.key` 里可能包含引用片段（如 `{"i":"q","_id":"..."}`），展示/摘要需要做引用展开且要防循环。

## 与本仓库的实现对应

- 读取能力库：`packages/agent-remnote/src/internal/remdb-tools/*`（`executeSearchRemOverview` / `executeInspectRemDoc` / `executeOutlineRemSubtree` 等）
- CLI 接线：`packages/agent-remnote/src/commands/read/*`
- 工具语义（规划/约束）：`docs/proposals/agent-remnote/read-tools-plan.md`

辅助定位（代码锚点）：

- 数据库发现/备份：`packages/agent-remnote/src/commands/db/recent.ts`、`packages/agent-remnote/src/commands/db/backups.ts`
