# Tasks: Batch Pull + Conflict-Aware Scheduling (010)

**Input**: `specs/010-batch-pull-conflict-scheduler/` (spec/plan/research/data-model)  
**Protocol Policy**: forward-only (breaking). 升级后不保留旧的 `RequestOp` / `OpDispatch` 路径。

**Hard Dependency**: `specs/013-multi-client-execution-safety/`（attempt_id + CAS ack + AckOk/重试）必须先对齐，否则 batch pull 在“多客户端切换 + lease 回收”下会出现回执覆盖/状态回滚风险。

**Note**: 本 spec 的协议升级属于 WS Protocol v2 合并包的一部分；`OpAck/AckOk/AckRejected` 的 attempt_id/CAS 语义以 013 为准（仍需在同一次 v2 升级里一并落地）。

## Phase 1: WS Protocol Upgrade (Breaking)

- [x] T001 Add `Register.protocolVersion` (+ optional `capabilities.batchPull=true`) in `packages/plugin/src/bridge/runtime.ts`
- [x] T002 Validate protocol version/capability and fail-fast with diagnostic Error (+ `nextActions`) in `packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts` (and related kernel types under `packages/agent-remnote/src/kernel/ws-bridge/**`)
- [x] T003 Implement `RequestOps` (plugin→daemon) / `OpDispatchBatch` (daemon→plugin) in `packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`
- [x] T004 Implement `requestOps()` + batch receive loop in `packages/plugin/src/bridge/runtime.ts` and `packages/plugin/src/bridge/ws.ts`
- [x] T005 Remove legacy `RequestOp` usage in `packages/plugin/src/bridge/runtime.ts` and reject legacy handler in `packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`
- [x] T006 Update SSoT protocol doc (breaking): `docs/ssot/agent-remnote/ws-bridge-protocol.md`

## Phase 2: Batch Pull MVP (No Scheduler)

- [x] T010 Daemon: build batch by looping `claimNextOp` (no conflict filtering) in `packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`
- [x] T011 Plugin: fill strategy uses `maxOps = maxConcurrency - inFlight.size` in `packages/plugin/src/bridge/runtime.ts`

## Phase 3: Conflict-Aware Scheduler (Daemon + Queue)

- [x] T020 Queue DAO: add `peekEligibleOps(peekLimit)` in `packages/agent-remnote/src/internal/queue/dao.ts` and re-export via `packages/agent-remnote/src/internal/queue/index.ts`
- [x] T021 Queue DAO: add `claimOpById(op_id, lockedBy, leaseMs)` in `packages/agent-remnote/src/internal/queue/dao.ts` and re-export via `packages/agent-remnote/src/internal/queue/index.ts`
- [x] T022 Daemon: implement ConflictKey derivation (payload-first, optional read-only RNDB fallback) in `packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts` (or new module under `packages/agent-remnote/src/kernel/`)
- [x] T023 Daemon: greedy selection + budgets + diagnostics, then claim selected ops and send `OpDispatchBatch` in `packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`
- [x] T024 Ensure scheduler respects txn ordering + “single in-flight per txn” (DAO + bridge runtime)

## Phase 4: Conflict Reporting (CLI)

- [x] T030 Internal: compute conflict clusters for pending ops (bounded scan + JSON-friendly output) in `packages/agent-remnote/src/internal/queue/dao.ts` (or new module under `packages/agent-remnote/src/internal/queue/`)
- [x] T031 CLI: add `agent-remnote queue conflicts` in `packages/agent-remnote/src/commands/queue/conflicts.ts` and wire in `packages/agent-remnote/src/commands/queue/index.ts`
- [x] T032 Optional: integrate summary into `packages/agent-remnote/src/commands/queue/stats.ts` and/or `packages/agent-remnote/src/commands/ws/status.ts`

## Phase 5: Operability (Queue DB Errors + Doctor)

- [x] T040 Improve queue DB errors: include `db_path`, raw sqlite error, and actionable `hint` in `packages/agent-remnote/src/services/Queue.ts`
- [x] T041 Extend `doctor` to check queue DB writability and output fix hints in `packages/agent-remnote/src/commands/doctor.ts`
- [x] T042 Standardize “post-enqueue nextActions” in `packages/agent-remnote/src/commands/_enqueue.ts`

## Phase 6: Tests

- [x] T050 Contract test: legacy `RequestOp` is rejected with a clear Error in `packages/agent-remnote/tests/contract/ws-protocol-legacy-requestop.contract.test.ts`
- [x] T051 Unit test: ConflictKey derivation for representative op types in `packages/agent-remnote/tests/unit/conflict-key.unit.test.ts`
- [x] T052 Unit test: scheduler selection picks non-overlapping keys in `packages/agent-remnote/tests/unit/scheduler-selection.unit.test.ts`
- [x] T053 “Integration-ish”: enqueue many ops into temp queue DB and validate dispatch selection deterministically in `packages/agent-remnote/tests/integration/scheduler.integration.test.ts`
