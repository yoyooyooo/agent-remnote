# Acceptance Report: 013-multi-client-execution-safety（上帝视角验收）

**Date**: 2026-01-25  
**Spec**: `specs/013-multi-client-execution-safety/spec.md`  
**Scope**: 覆盖 `spec.md` 内所有编码点：FR / NFR / SC  

## 总结裁决

- **整体结论**：通过（PASS）。`attempt_id` 贯穿派发与回执、ack 落库 CAS、终态不可回滚、lease 回收保守、插件 ack 重试与 `id_map` 不漂移语义均已形成可验证基线。

## 证据索引（高信号）

- 队列 schema + forward-only migrations：`packages/agent-remnote/src/internal/queue/{schema.sql,db.ts}`
- Queue DAO（claim/ack/recover + id_map guard）：`packages/agent-remnote/src/internal/queue/dao.ts`
- WS 协议 SSoT（attempt_id + AckRejected + Error shape）：`docs/ssot/agent-remnote/ws-bridge-protocol.md`
- WS bridge runtime（attempt_id/CAS/AckRejected + ID_MAP_CONFLICT 诊断）：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`
- Plugin ack 重试与 dedup 一致性：`packages/plugin/src/bridge/runtime.ts`、`packages/plugin/src/bridge/ops/executeOp.ts`
- Contract / Integration-ish tests：
  - ack CAS：`packages/agent-remnote/tests/contract/queue-ack-cas.contract.test.ts`
  - stale ack + 终态不回滚：`packages/agent-remnote/tests/integration/ws-bridge-runtime.integration.test.ts`
  - `id_map` 不漂移：`packages/agent-remnote/tests/contract/queue-id-map-no-drift.contract.test.ts`

## 覆盖矩阵（FR/NFR/SC）

| Code | 结论 | 证据（实现/测试/文档） | 漂移/缺口 |
|---|---|---|---|
| FR-001 | PASS | `packages/agent-remnote/src/internal/queue/{schema.sql,db.ts}`、`docs/ssot/agent-remnote/queue-schema.md` | 无 |
| FR-002 | PASS | `docs/ssot/agent-remnote/ws-bridge-protocol.md`、`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`、`packages/plugin/src/bridge/runtime.ts` | 无（v2 的版本门禁/batch pull 由 010 实现） |
| FR-003 | PASS | `packages/agent-remnote/src/internal/queue/dao.ts`、`packages/agent-remnote/tests/contract/queue-ack-cas.contract.test.ts` | 无 |
| FR-004 | PASS | `packages/plugin/src/bridge/runtime.ts`（pendingAcks + AckOk 驱动重试） | 无 |
| FR-005 | PASS | `packages/agent-remnote/src/internal/queue/dao.ts`（claim 生成新 attempt_id；recoverExpiredLeases 仅回收仍命中 attempt/conn） | 无 |
| FR-006 | PASS | `packages/agent-remnote/src/internal/queue/dao.ts`（`IdMapConflictError` + 不覆盖）、`packages/agent-remnote/tests/contract/queue-id-map-no-drift.contract.test.ts`、`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`（`ID_MAP_CONFLICT` + nextActions） | 无 |
| NFR-001 | PASS | `AckRejected`/`op_attempts` 记录 attempt/conn；`docs/ssot/agent-remnote/ws-bridge-protocol.md` | 无 |
| NFR-002 | PASS | contract/integration-ish tests（无外部 RemNote 依赖；避免 flaky） | 无 |
| SC-001 | PASS | `packages/agent-remnote/tests/integration/ws-bridge-runtime.integration.test.ts`（stale ack 被拒绝；新 attempt 生效） | 无 |
| SC-002 | PASS | `packages/plugin/src/bridge/runtime.ts`（AckOk 驱动的重试 flush）+ `packages/agent-remnote/src/internal/queue/dao.ts`（duplicate ack 视为 ok） | 无 |
| SC-003 | PASS | `packages/agent-remnote/src/internal/queue/dao.ts`、`packages/agent-remnote/tests/contract/queue-id-map-no-drift.contract.test.ts`、`docs/ssot/agent-remnote/queue-schema.md` | 无 |

## 漂移/缺口矩阵（聚焦问题）

- 无

## Next Actions（按路线）

1) 推进 `010-batch-pull-conflict-scheduler`：引入 WS Protocol v2（`protocolVersion=2` + `RequestOps/OpDispatchBatch`），并复用本 spec 的 attempt_id/CAS/ack 重试语义。

