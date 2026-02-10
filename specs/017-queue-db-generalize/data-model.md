# Data Model: Store DB（vNext）

目标：为“写入队列 + 自动化触发/任务 + 回写结果”提供同一份可追溯的本地事实库（SQLite）。

> 注：表名与字段以“概念模型 + 关键约束”为主；实现阶段会以 `docs/ssot/agent-remnote/*` 与 `packages/agent-remnote/src/internal/**/schema.sql` 为准落 DDL。

## Naming

- Store DB 文件：`store.sqlite`
- 模块命名空间：
  - `queue_*`：写入队列与回执/映射
  - `event_*`：插件/系统观测事件
  - `trigger_*`：触发规则
  - `task_*`：任务定义与任务运行

## Queue（queue_*）

### `queue_txns`（事务/批次）

- `txn_id`（PK）
- `status`（pending/ready/in_progress/succeeded/failed/aborted）
- `priority`
- `idempotency_key`（unique, optional）
- `client_id`（optional）
- `meta_json`（必须能承载 `task_run_id` 等可追溯字段）
- `created_at/updated_at/committed_at/finished_at`

### `queue_ops`（最小执行单元）

- `op_id`（PK）
- `txn_id`（FK）
- `op_seq`
- `type`
- `payload_json`
- `status`（pending/in_flight/succeeded/failed/dead）
- `idempotency_key`（optional, unique where not null）
- `op_hash`
- `attempt_id/attempt_count/max_attempts`
- `deliver_after/next_attempt_at`
- `locked_by/locked_at/lease_expires_at`
- `dead_reason`
- `created_at/updated_at`

### Results / Attempts / Dependencies / IdMap / Consumers

- `queue_op_results`：成功结果与失败信息（审计/回读）
- `queue_op_attempts`：派发尝试历史（多客户端排障）
- `queue_op_dependencies`：表达跨 op gating（可选）
- `queue_id_map`：`client_temp_id -> remote_id` 映射（不得漂移）
- `queue_consumers`：consumer 活跃记录（如需要）

## Events（event_*）

### `event_log`（事实事件流，append-only 或逻辑只增）

- `event_id`（PK）
- `kind`（例如 `tag_added`）
- `dedupe_key`（unique）：确定性去重键（event source + target + kind + ts bucket 等）
- `payload_json`：原始事件数据（包含 target rem/tag 等最小字段）
- `source_conn_id` / `source_client_instance_id`（可选，用于诊断）
- `observed_at`

## Triggers（trigger_*）

### `trigger_defs`

- `trigger_id`（PK）
- `kind`（例如 `on_tag_added`）
- `enabled`（boolean）
- `config_json`（规则细节：tagId、过滤条件、节流等）
- `created_at/updated_at`

## Tasks（task_*）

### `task_defs`

- `task_id`（PK）
- `kind`（例如 `summarize_and_append_child`）
- `enabled`（boolean）
- `config_json`（任务参数：模板/外派端点/写回策略等）
- `created_at/updated_at`

### `task_runs`（实例与状态机）

- `run_id`（PK）
- `task_id`（FK）
- `trigger_id`（FK, optional）
- `event_id`（FK, optional）
- `status`（pending/in_progress/succeeded/failed/aborted）
- `dedupe_key`（unique）：确保同一事件不会重复生成 run
- `target_rem_id`（必填）
- `result_rem_id`（optional）：写回子级 rem 的 id（成功后可填）
- `queue_txn_id`（optional）：若 run 产生写回，则关联对应 queue txn（或等价 link）
- `input_json` / `output_json`
- `error_code` / `error_message`
- `created_at/started_at/finished_at/updated_at`

## Traceability invariants（硬不变量）

- 任意 `task_run` 必须可追溯到其触发来源（event/trigger）与目标 Rem（`target_rem_id`）。
- 任意写回（queue txn）必须可追溯到其来源（至少 `task_run_id`）。
- 去重必须确定性：重复上报同一事件不得重复创建 `task_run` 或重复写回。
