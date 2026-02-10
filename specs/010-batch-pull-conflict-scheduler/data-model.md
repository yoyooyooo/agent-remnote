# 数据模型：批量拉取 + 冲突感知调度

## WS 消息

### `Register`（插件 → daemon）

目的：建立连接身份与协议版本的显式握手（forward-only）。

示例：

- `type`: `'Register'`
- `protocolVersion`: `number` (e.g. `2`)
- `capabilities` *(optional)*: `{ batchPull: true }`

### `RequestOps`（插件 → daemon）

目的：插件侧工作协程表达背压，并在一次往返中请求最多 N 条操作（op）。

示例：

- `type`: `'RequestOps'`
- `leaseMs`: `number` (e.g. `120000`)
- `maxOps`: `number` (e.g. `8`)
- `maxBytes` *(optional)*: `number` (e.g. `1048576`)

### `OpDispatchBatch`（daemon → 插件）

目的：daemon 返回一批已认领（claim）的操作（op）。

示例：

- `type`: `'OpDispatchBatch'`
- `ops`: `Array<OpDispatch>`

其中 `OpDispatch` 复用既有字段：

- `op_id`, `txn_id`, `op_seq`, `op_type`, `payload`, `idempotency_key`
- `attempt_id`（见 `specs/013-multi-client-execution-safety`：用于 CAS ack，避免 stale 回执污染新派发）

### `OpAck` / `AckOk` / `AckRejected`（v2：attempt_id 绑定回执）

> 这些消息在 v2 中必须携带并校验 `attempt_id`；语义与不变量以 013/`specs/CONCEPTS.md` 为准，本 spec 不重复定义。

#### `OpAck`（插件 → daemon）

- `type`: `'OpAck'`
- `op_id: string`
- `attempt_id: string`
- `status: 'success'|'retry'|'failed'|'dead'`

#### `AckOk`（daemon → 插件）

- `type`: `'AckOk'`
- `op_id: string`
- `attempt_id: string`

#### `AckRejected`（daemon → 插件）

- `type`: `'AckRejected'`
- `op_id: string`
- `attempt_id: string`
- `reason: 'stale_attempt'|'not_locked'|'invalid'|string`

### 协议版本（forward-only）

- 插件必须在 `Register` 中携带 `protocolVersion`（以及可选的能力声明）；daemon 必须校验版本，不匹配时快速失败并给出可诊断错误。
- 升级后不保留旧的 `RequestOp` / `OpDispatch` 兼容路径；收到旧消息类型应返回错误并拒绝继续处理。

## `ConflictKey`（冲突键）

`ConflictKey` 是调度器使用的一组保守的“互斥键”，用于避免把可能冲突的 ops 在同一批次中同时派发。

### 键类型

- `rem:<remId>`：对某个具体 Rem 的任何写入/修改/删除
- `children:<parentId>`：父节点之下的结构性变更（追加/移动/删除可能影响兄弟顺序）
- `global:<name>`：对已知特殊场景的粗粒度锁（例如 `daily_note_write`）

### 推导规则（daemon 侧）

daemon 应优先从 `op` 的 `payload` 推导冲突键；必要时也可以只读查询本地 RemNote DB，用于补齐缺失的 `parentId` / `pageId` 等信息。

基线（安全）规则：

- 创建类操作（op）（`create_*`, `create_tree_with_markdown`）：锁 `rem:<parentId>` + `children:<parentId>`（`payload` 已含 `parent`）
- 文本/元信息类操作（op）（`update_text`, `add_tag`, `remove_tag`, `set_attribute`, `table_cell_write` 等）：锁 `rem:<remId>`
- 结构类操作（op）（`move_rem`, `delete_rem`, `replace_selection_with_markdown`）：锁 `rem:<remId>`，并尽力补齐 `parent` / `children` 相关锁（可读 DB 时就补齐）；若无法推导，则退化为 `global:structure_unknown`

> 说明：插件侧已计算相似的锁键（见 `packages/plugin/src/bridge/opConcurrency.ts`）。daemon 侧实现应尽量对齐，但允许更保守（宁可多串行，也不要误并发）。
>
> 建议：中长期把“冲突键推导规则”收敛到 Op Catalog（seed：`specs/006-table-tag-crud/contracts/ops.md`，上层概念见 `specs/CONCEPTS.md`），由 catalog 生成/提供推导入口，避免 010/012/插件三处各自 hardcode 漂移。

## 调度算法（贪心：最大不冲突子集）

输入：

- 可执行的 `pending` 操作（op）（最多预览 `peekLimit` 条，按 `priority`, `created_at`, `op_seq` 排序）
- 请求预算：`maxOps`, `maxBytes`

输出：

- 被选中的操作（op）（认领/派发；冲突键不相交）
- 跳过摘要（可选）：哪些键导致冲突、对应计数

算法（推荐 MVP）：

1. 先查询前 `peekLimit` 条可执行 ops（不修改 DB）。
2. 为每条 op 推导 `ConflictKey[]`。
3. 按顺序贪心挑选：
   - 若 op 的所有键都不在 `usedKeys`，则接受
   - 否则跳过（并记录阻塞它的键）
4. 对被选中的操作（op）执行乐观认领（claim）（`pending` -> `in_flight` + lease）。
5. 返回 `OpDispatchBatch`（包含已认领的操作）；若未认领到任何 op，则返回 `NoWork`。

预算：

- `peekLimit`：默认 200（可配置）
- `maxOps`：daemon 强制限制为 <= 20
- `maxBytes`：daemon 强制限制为 <= 1MB

降级策略：

- 若冲突键推导失败或超预算，退化为“循环 `claimNextOp` 直到 `maxOps`”。
