# Specs Concepts（全局概念与对齐裁决）

本文件是 `specs/**` 的“上帝视角”对齐裁决点：当多个 spec（例如 006/010/011/012/013）在术语、协议、数据模型、诊断契约上出现重叠或潜在冲突时，以此为准进行归一与提炼。

> 约定：所有“用户可见”的错误信息/nextActions 必须英文；本文件为内部裁决文档，允许中文叙述。

## 三个 Plane（上层概念）

把系统拆成三条平面，以避免 spec 各自定义隐含不变量：

1) **Control Plane（连接/会话）**
   - 关注：连接身份、能力、协议版本、active worker 选举与切换。
   - 关键对象：`connId`、`clientInstanceId`、`protocolVersion`、`capabilities`、`activeWorkerConnId`。

2) **Data Plane（执行语义/一致性）**
   - 关注：队列执行、lease、派发尝试、回执确认、幂等与映射稳定性。
   - 关键对象：`txn_id`、`op_id`、`attempt_id`、`lease_expires_at`、`id_map`、`op_results/op_attempts`。

3) **UX Plane（命令面/诊断）**
   - 关注：write-first、命令收口、稳定输出、可恢复 nextActions。
   - 关键对象：CLI surface（011/012）、错误码与 envelope 契约、最短闭环动作（inspect/progress/ensure）。

## 关键术语（Glossary）

- `connId`：服务端为每条 WS 连接分配的唯一连接实例 ID（断线重连会变化）。
- `clientInstanceId`：插件运行实例在本机/该环境持久化的实例 ID（用于跨重连诊断；桌面端与网页端一般不共享）。
- `protocolVersion`：WS 协议大版本（forward-only）；版本不匹配必须 fail-fast + 可诊断 nextActions。
- `txn_id`：一次入队提交（可能包含多 op）的事务 ID。
- `op_id`：队列中一条操作（op）的唯一 ID。
- `attempt_id`：一次派发尝试的唯一 ID；同一 `op_id` 在 lease 回收/重派发后会产生新的 `attempt_id`。
- `client_temp_id`：用于“创建类产物”的临时 ID（由 012 编译或调用方生成）；通过 `id_map` 延迟解析为 `remote_id`。
- `id_map`：`client_temp_id -> remote_id` 映射表；它是事实表（不可漂移）。
- `idempotency_key`：
  - `txns.idempotency_key`：提交级（submission-level）幂等，用于 012 的批次重试不产生重复 txn。
  - `ops.idempotency_key`：语义级（semantic-level）幂等的候选锚点；若使用，必须保证“跨实例可证明一致”的策略（见下文）。

## WS Protocol v2（统一升级包）

下一次 breaking 建议合并为 **WS Protocol v2**（避免 010/013 分两次改协议）：

- 来自 010：
  - `Register.protocolVersion=2`（以及能力声明，如 `capabilities.batchPull=true`）
  - `RequestOps` / `OpDispatchBatch`（替代 `RequestOp` / `OpDispatch`）
- 来自 013：
  - `attempt_id` 贯穿 `OpDispatch*` / `OpAck` / `AckOk`（以及 `AckRejected`）
  - 插件侧 ack 重试（未收到 AckOk 前重试发送 OpAck）
  - 可选 `LeaseExtend`（长 op 续租，降低重复执行窗口）

**裁决**：v2 必须同时包含 batch pull 与 attempt_id/CAS ack 语义；不接受“先 batch pull、后补 attempt”的分阶段协议升级（实现可以分阶段，但协议版本只升一次）。

## Queue schema 迁移（forward-only）

队列 DB 必须具备明确的向前迁移策略（否则 `ALTER TABLE` 无法落地）：

- 使用 `PRAGMA user_version` 维护 schema 版本。
- 仅支持向前迁移（forward-only）；版本不匹配必须 fail-fast + 可诊断修复建议。
- 任何需要新增列/索引/约束的 spec（尤其 010/012/013）必须把迁移作为交付物的一部分，而不是隐含假设。

## Data Plane 不变量（必须满足）

1) **派发尝试绑定回执（attempt_id + CAS ack）**
   - ack 落库必须命中当前 attempt：`status='in_flight' AND locked_by=<connId> AND attempt_id=<attempt_id>`。
   - stale/invalid ack 必须拒绝（AckRejected），不得修改 ops/op_results/id_map。

2) **终态不可回滚**
   - `succeeded/dead` 一旦写入，不得被迟到 ack 或 lease 回收改回 `pending`。

3) **`id_map` 不可漂移**
   - 同 `client_temp_id` 一旦映射到 `remote_id`，后续不得覆盖为不同值；冲突必须 fail-fast（稳定错误码 + nextActions）。

## 语义幂等（Semantic Idempotency）提炼

不要把“传输重试”与“语义幂等”混为一谈：

- 传输重试（transport-level）优先由 `attempt_id + ack 重试 +（可选）LeaseExtend` 解决，目标是把“执行成功但回执丢失”窗口压到极小。
- 语义幂等（semantic-level）仅在确有必要时引入（尤其 create 类 op），且必须具备跨实例可证明一致的锚点：
  - 优先锚点：`client_temp_id` + `id_map`（共享于 queue DB，跨实例可见）。
  - `ops.idempotency_key` 若使用，必须定义“跨实例可复现”的 dedup 证据与结果回放策略（否则只能保证单实例内去重，无法覆盖桌面/网页双实例）。

## 写入足迹（Write Footprint）= ConflictKey[]

为避免“并发吞吐提升”反向扩大冲突面，引入统一的写入足迹概念：

- `WriteFootprint(op)` 是一组保守的 `ConflictKey`，用于：
  - 010 调度器挑选非冲突批次
  - 插件侧并发锁（同一实例内）
  - CLI 冲突报告（queue conflicts）
- `ConflictKey` 的基线集合：`rem:<id>`、`children:<id>`、`global:<name>`

**裁决**：daemon 侧调度必须把“当前全局所有 in_flight ops 的足迹”计入 `usedKeys`（避免 active worker 迁移后跨实例并发冲突写入）。

## Op Catalog（上层概念，建议落地为单一真理）

未来建议把“支持的 op.type + payload schema + ID 语义字段 + WriteFootprint 推导规则 + result shape”收敛为一个 Op Catalog：

- `specs/006-table-tag-crud/contracts/ops.md` 已是一个可用雏形（以插件 handler 为裁决点）
- 012 的 plan 校验/编译与 010 的冲突键推导应复用同一份 catalog（或由其生成）

## 诊断输出（UX Plane）归一

所有面向 Agent 的输出（CLI/WS 错误）应遵守以下一致性：

- 错误码稳定：`error.code`（机器可判定）+ `error.message`（英文）。
- 可行动：必须提供 `hint`（英文一句话）与 `nextActions[]`（英文可复制命令/动作）。
- 输出纯度：`--json`/`--ids` 模式 stdout 必须纯净；warnings/提示走 stderr 或结构化字段（由 011 契约裁决）。

## 与各 spec 的关系（索引）

- Control Plane：003（已实现）→ v2 升级（010 planned）
- Data Plane：013（planned，核心不变量）
- UX Plane：011/012（planned）
- Op Catalog：006（planned，op/payload/语义边界）

