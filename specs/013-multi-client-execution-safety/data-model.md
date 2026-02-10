# 数据模型：多客户端执行安全（attempt_id + CAS ack）

## Queue DB（schema vNext）

> forward-only：允许 breaking；版本不匹配必须 fail-fast。

### ops 表新增字段（建议）

- `attempt_id TEXT`：本次派发尝试 id（UUID）；claim 时生成；重派发必须更新。
- `claimed_at INTEGER`：claim 时间（ms）。
- `acked_at INTEGER`：最后一次被确认写入结果的时间（ms，便于观测 no-progress）。

可选增强：

- `attempt_seq INTEGER`：同 op 的尝试序号（从 1 递增，便于排障）。
- `last_error_code/last_error_message`：快速诊断（仍以 op_results 为准）。

### op_results 表增强（建议）

增加 attempt 维度，避免“最后一次覆盖”掩盖历史：

- `attempt_id TEXT`：对应 attempt
- `ack_conn_id TEXT`：回执来源 connId
- `status TEXT`：`success|retry|failed|dead`
- `result_json/error_*`：同现有
- `finished_at`：同现有

也可以新增 `op_attempts` 表保存历史（推荐）：

```sql
CREATE TABLE IF NOT EXISTS op_attempts (
  op_id       TEXT NOT NULL,
  attempt_id  TEXT NOT NULL,
  conn_id     TEXT,
  status      TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (op_id, attempt_id),
  FOREIGN KEY (op_id) REFERENCES ops(op_id) ON DELETE CASCADE
);
```

## WS 协议（vNext）

> 本节定义 WS Protocol v2 的“回执一致性子集”（attempt_id/CAS ack）；batch pull 的消息形状见 `specs/010-batch-pull-conflict-scheduler/data-model.md`。在 v2 中，`OpDispatch` 作为 `OpDispatchBatch.ops[]` 的 item 发送。

### OpDispatch（daemon → plugin）

在现有字段基础上新增：

- `attempt_id: string`
- `lease_expires_at?: number`（可选，用于插件侧诊断/续租）

### OpAck（plugin → daemon）

必须携带：

- `op_id: string`
- `attempt_id: string`
- `status: 'success'|'retry'|'failed'|'dead'`

### AckOk（daemon → plugin）

必须携带：

- `op_id: string`
- `attempt_id: string`
- `ok: true`

若拒绝（stale/invalid），返回：

- `type: 'AckRejected'`
- `op_id`
- `attempt_id`
- `reason: 'stale_attempt'|'not_locked'|'invalid'|...`

### LeaseExtend（可选）

长 op（或批量执行）可发送续租：

- `type: 'LeaseExtend'`
- `op_id`
- `attempt_id`
- `extendMs`

daemon 只允许对“当前 attempt”续租；否则拒绝。

## Invariants（实现必须满足）

1. `claim -> in_flight` 必须写入新的 `attempt_id`。  
2. `ack*` 必须是 CAS：只命中当前 in_flight attempt 才能修改 ops/op_results/id_map。  
3. `recoverExpiredLeases` 只允许回收 `in_flight` 且 attempt 未变化的记录；不得回收终态。  
