# Contract: CLI Surface for Write Unification（草案）

> 本合同用于 011 的实现阶段，先裁决“面向 Agent 的命令面”和最小不歧义规则；SSoT 将在实现落地后再同步。

## Decision（v1）

- 采用 **Option B**：新增 `agent-remnote write advanced ops` 作为唯一 raw 入队入口，并删除 `agent-remnote apply` 与 `agent-remnote queue enqueue`（forward-only，允许 breaking change，但不保留长期歧义入口）。

## Canonical Mapping（Agent 选择标准）

1. **日常语义写入**：优先 `write/*`、`write daily`、`write replace/*`（由命令内部做校验与诊断）。默认只需“入队即可”（fire-and-forget）；仅当后续操作存在依赖（或用户明确要求确认落库）时才启用 `--wait/--timeout-ms` 做一次有界等待。
2. **多步依赖写入（批量计划）**：优先 `write plan`（依赖 012）。
3. **仅当调用方已构造 raw ops**：使用 raw 入队的唯一入口（见下一节）。

## Raw Enqueue Unification（裁决候选）

### Option B（Selected）：新增 `write advanced ops`，并删除 `apply` + `queue enqueue`

- Pros：写入入口统一挂到 `write`；Agent 认知成本最低。
- Cons：breaking change 较大，需要同步更新脚本/文档/调用点。

> Note: 若需要“只入队不触发同步”的语义，通过 `write advanced ops --no-notify`（以及可选 `--no-ensure-daemon`）表达，而不是通过另一个命令入口表达。

## Output Contract（成功/失败 envelope）

### Success

- MUST include: `txn_id`, `op_ids[]`（或命令语义对应的 rem ids）
- SHOULD include: `nextActions[]`（英文命令，用于后续闭环/观测/排障）
- SHOULD include: `deduped`（当 `--idempotency-key` 命中既有 txn 时，用于提示“本次未重复入队”）

### Failure

- MUST include: stable `code`, human `message`, actionable `hint`
- SHOULD include: `nextActions[]`（英文命令）
- MUST keep `--json` / `--ids` stdout purity

## Wait Unification（写入后闭环确认：Option B）

> 本节裁决 “等待 txn 终态” 的入口：写入命令收口，queue 侧保留为诊断工具但不作为 Agent 默认路径。

### Decision

- 采用 **Option B**：所有写入相关命令（`write *` / `write daily` / `write replace *` / `write advanced ops`）增加 `--wait/--timeout-ms`（以及可选 `--poll-ms`），在同一次调用中等待 txn 进入终态（succeeded/failed/aborted）。

### Semantics (v1)

- `--wait`：启用等待；默认 `false`（由 Agent/封装层决定是否默认开启）。
- `--timeout-ms`：等待超时（默认值在实现中裁决；需可覆盖）。
- 超时/失败必须返回稳定错误码，并给出可执行 next actions（daemon status/sync/restart + queue inspect 等），避免引导“再写一次”的危险路径。
