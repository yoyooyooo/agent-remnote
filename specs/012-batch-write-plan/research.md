# Research: Batch Write Plan（按 011 标准重规划）

## Current Inventory（可复用的原子写入能力）

### 语义写入（优先入口）

- `agent-remnote write md`
- `agent-remnote write bullet`
- `agent-remnote write daily`
- `agent-remnote write replace text`
- `agent-remnote write replace block`

### raw 入队（将由 011 收口）

- `agent-remnote write advanced ops`（唯一 raw 入队入口；需要“只入队”时用 `--no-notify`）

## Key Findings（影响 012 设计的事实）

1. 队列 schema 已支持 `txns(idempotency_key UNIQUE)` 与 `id_map(client_temp_id → remote_id)`。
2. `claimNextOp` 已提供“同一 txn 串行执行”的顺序门禁：前序 op 未 `succeeded` 时，后续 op 不会被 dispatch（天然满足批量步骤的顺序语义）。
3. 当前 bridge/daemon 侧存在 **id_map 只写不读** 的缺口：plugin ack 会回填 `id_map`，但 dispatch 前不会用 `id_map` 替换 payload 中的 temp id。

## Risks / Open Questions（需要在实现阶段明确）

- `@alias` 引用允许出现在哪些字段上（严格限制在 `*_id/*_ids` 还是允许更泛化的 target 字段）？
- 幂等冲突时的回执策略：返回已有 txn 的结构化结果（推荐），还是直接报错提示用户更换 key？
- v1 的 step types 范围：只覆盖现有 write/replace，还是同步引入 006 的 table/tag 相关步骤（建议分阶段）。

## Alignment With 011

- 012 的 CLI/错误/next actions 必须遵守 011 的写入命令标准；raw 入队细节视为实现内部。
