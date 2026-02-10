# Data Model 004：notify / kick / progress

**Feature**: `specs/004-sync-reliability/spec.md`  
**Date**: 2026-01-24

## 1) Notify result（CLI）

写入命令返回（JSON）建议字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `txn_id` | string | 本次写入对应事务 id |
| `op_ids` | string[] | 本次写入产生的 op ids |
| `notified` | boolean | 是否完成了 notify 尝试（成功触发 WS） |
| `sent?` | number | StartSync 实际发送数量（sent=0 表示“无 active worker”） |
| `warnings?` | string[] | 建议动作（英文句子），非 JSON 输出也应可见 |

## 2) Kick loop（bridge）

### KickConfig（建议）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---:|---|
| `enabled` | boolean | true | 是否启用 kick loop |
| `intervalMs` | number | 30000 | kick 检查周期；0 表示关闭 |
| `cooldownMs` | number | 15000 | 最小冷却（避免短时间重复 kick） |
| `noProgressWarnMs` | number | 30000 | 无进展阈值 1（重 kick / 重选） |
| `noProgressEscalateMs` | number | 90000 | 无进展阈值 2（兜底策略） |

### Progress signal（桥内可观测）

为了定义“无进展”，bridge 需要一个廉价的进展信号。建议在内存中维护：

- `lastDispatchAt`: number（最近一次 `OpDispatch` 发出时间）
- `lastAckAt`: number（最近一次 `OpAck` 收到时间）
- `lastKickAt`: number（最近一次 kick 发送 StartSync 的时间）

定义：

```text
progressAt = max(lastAckAt, lastDispatchAt)
noProgressForMs = now - progressAt
```

> 备注：`lastAckAt` 比 `queueStats` 更可靠；`queueStats` 用于判断“是否有活”，不用于判定进展。

### Active worker dependency（Spec 003）

- kick 目标必须是 active worker（唯一消费）；无 active worker 时不得空转刷屏，只记录状态并返回 `sent=0`。

## 3) Txn progress（CLI）

### TxnProgress（建议）

| 字段 | 类型 | 说明 |
|---|---|---|
| `txn_id` | string | 事务 id |
| `status` | `'ready' \| 'in_progress' \| 'succeeded' \| 'failed' \| 'aborted' \| 'unknown'` | 事务状态（来自 queue） |
| `ops_total` | number | 总 op 数 |
| `ops_succeeded` | number | 成功数 |
| `ops_failed` | number | 失败但可重试数 |
| `ops_dead` | number | dead 数（不可重试/超限） |
| `ops_in_flight` | number | in_flight 数 |
| `score` | number | 0..100，进度条 |
| `is_done` | boolean | 是否终态（成功或失败） |
| `is_success` | boolean | 是否成功终态 |
| `last_update_at?` | number | 最后变更时间（用于判定是否卡住） |
| `nextActions?` | string[] | 建议型动作（英文句子） |

### score 口径（建议）

- `score = floor(100 * (ops_succeeded + ops_dead) / ops_total)`（dead 计入“已完成”，但 `is_success=false`）
- 终态：
  - `ops_dead>0` → `status='failed'` / `is_done=true` / `is_success=false`
  - `ops_succeeded==ops_total` → `status='succeeded'` / `is_done=true` / `is_success=true`

## 4) State file（可选增强）

为便于排障，可在 `~/.agent-remnote/ws.bridge.state.json` 增加（或内嵌到 server 部分）：

- `kick`: `{ enabled, intervalMs, lastKickAt, lastDispatchAt, lastAckAt, noProgressForMs }`
- `activeWorkerConnId`（来自 Spec 003）
