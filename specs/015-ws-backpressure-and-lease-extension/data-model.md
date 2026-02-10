# Data Model: Budget + LeaseExtend (015)

## WS Protocol（增量）

> 权威协议最终以 `docs/ssot/agent-remnote/ws-bridge-protocol.md` 为准；本文件用于实现期聚焦字段与校验口径。

### RequestOps（Client → Server）

新增字段（建议）：

- `maxBytes?: number`：本次期望服务端返回的 `OpDispatchBatch` 近似上限（bytes）
- `maxOpBytes?: number`：单条 op 的近似上限（bytes）

服务端必须对两者做 clamp，并以诊断字段回显“请求值/生效值”。

### OpDispatchBatch（Server → Client）

新增字段（建议）：

- `budget?: { maxOpsRequested, maxOpsEffective, maxBytesRequested, maxBytesEffective, approxBytes, scanLimit }`
- `skipped?: { overBudget?: number, oversizeOp?: number, conflict?: number, txnBusy?: number }`

### LeaseExtend（Client → Server）

```json
{ "type": "LeaseExtend", "op_id": "...", "attempt_id": "...", "extendMs": 30000 }
```

服务端校验：

- `ops.status='in_flight' AND ops.locked_by=<connId> AND ops.attempt_id=<attempt_id>`

命中才更新 `lease_expires_at = max(lease_expires_at, now + extendMsEffective)`。

建议响应（便于诊断，但客户端可忽略）：

```json
{ "type": "LeaseExtendOk", "ok": true, "op_id": "...", "attempt_id": "...", "lease_expires_at": 0 }
```

或拒绝：

```json
{ "type": "LeaseExtendRejected", "ok": false, "op_id": "...", "attempt_id": "...", "reason": "stale_attempt|not_found|not_in_flight", "current": { "...": "..." } }
```

## Queue schema（增量）

不要求新增列（复用 `lease_expires_at/attempt_id/locked_by`），但需要新增 DAO API：

- `extendLease`：命中当前 attempt 时延长 lease（CAS）。

## Budget 估算口径（裁决待固化）

实现期建议以“近似但稳定”为目标：

- `approxBytes(op) = byteLength(JSON.stringify({ op_id, attempt_id, txn_id, op_type, payload }))`
- `approxBytes(batch) = sum(approxBytes(op)) + fixedOverhead`

估算必须 deterministic（同一 payload 得到同一估算），以便测试可回归。
