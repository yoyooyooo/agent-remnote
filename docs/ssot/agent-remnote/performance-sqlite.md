# SQLite 读性能排查与优化（RemNote 本地库）

本仓库对 RemNote 官方数据库仅做**只读查询**（禁止直接修改官方 DB）。因此性能优化优先集中在：

- 让查询命中**已存在的索引**（尤其是 JSON 表达式索引）
- 减少不必要的全表扫描/全量遍历
- 区分“开发态启动开销”与“真实查询耗时”

## 先区分：dev/tsx 启动 vs 查询耗时

`agent-remnote` 开发态常用 `tsx` 直接跑 `src/main.ts`，启动会额外耗时。做性能基准时建议用构建产物：

- 构建：`npm run build --workspace agent-remnote`
- 运行：`node packages/agent-remnote/cli.js daily summary --days 7 --max-lines 40`

## 通用排查套路（建议顺序）

1. **最小复现**：找到最慢的子命令/子查询（例如 `rem outline`）。
2. **抽出核心 SQL**：直接对 SQLite 执行（或用同等参数跑工具）。
3. **看执行计划**：`EXPLAIN QUERY PLAN <sql>`，重点关注：
   - `SCAN <table>`（全表扫描）
   - `USE TEMP B-TREE FOR ORDER BY`（排序临时表，是否可接受）
   - 是否出现预期的 `SEARCH ... USING INDEX ...`
4. **盘点可用索引**：
   - `PRAGMA index_list('quanta')`
   - `SELECT sql FROM sqlite_master WHERE type='index' AND name='...'`
5. **落地修复**：优先“让 planner 自动选对索引”；必要时可 `INDEXED BY` 强制，但必须提供回退。

## 本次案例：`outline_rem_subtree` 递归子树查询过慢

现象：`daily summary` 每天会调用一次 `outline_rem_subtree`，累计导致整体耗时偏高。

根因：递归 CTE 在 `JOIN tree ON json_extract(child.doc, '$.parent') = tree.id` 上未命中 `json_quanta_parent`（表达式索引），导致递归步对 `quanta` 发生近似全表扫描。

修复：在递归步对 `child` 显式指定 `INDEXED BY json_quanta_parent`；若目标 DB 不存在该索引则自动回退到原查询，保证兼容性与可用性。

- 实现位置：`packages/agent-remnote/src/internal/remdb-tools/outlineRemSubtree.ts`

## 可复用的经验规则（适用于其它 JSON/FTS 查询）

- **表达式要“字面一致”**：SQLite 的表达式索引要求查询中的表达式与索引定义一致（同样的 `JSON_EXTRACT(doc,'$.parent')` 形态）。
- **`INDEXED BY` 是最后手段**：只在确认 planner 选错且影响显著时使用；并对“缺少索引”的库提供回退路径。
- **仅需预览时避免全量遍历**：如果只需要前 N 行/节点，可考虑增加“预览 API”（例如仅取 `maxNodes+1` 并用 `hasMore` 推断截断），避免为 `totalNodeCount` 付出全量成本。
