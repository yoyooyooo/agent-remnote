# Tasks: Multi-Client Execution Safety (013)

**Input**: `specs/013-multi-client-execution-safety/`  
**Prerequisites**: `spec.md`, `data-model.md`, `plan.md`

## Phase 0: Spec & Wiring（仅规划）

- [x] T000 创建 013 规格骨架：`specs/013-multi-client-execution-safety/**`
- [x] T001 在 010/011/012 中补齐依赖与任务引用：`specs/{010,011,012}-*/**`

## Phase 1: Queue schema + DAO

- [x] T009 Migration framework: 引入 `PRAGMA user_version` + migrations runner（forward-only，版本不匹配 fail-fast + 可诊断错误码/nextActions）；`schema.sql` 作为“最新快照”，并确保 `FALLBACK_SCHEMA_SQL` 不漂移：`packages/agent-remnote/src/internal/queue/db.ts` + `packages/agent-remnote/src/internal/queue/schema.sql`
- [x] T010 Schema: ops 增加 `attempt_id`（可选 `claimed_at/acked_at`）并完成 forward-only 迁移：`packages/agent-remnote/src/internal/queue/{schema.sql,db.ts}`
- [x] T011 DAO: claim 生成 `attempt_id` 并写入；返回 dispatch payload 含 attempt_id：`packages/agent-remnote/src/internal/queue/dao.ts`
- [x] T012 DAO: ackSuccess/Retry/Dead 改为 CAS（status+locked_by+attempt_id 命中才更新）：`packages/agent-remnote/src/internal/queue/dao.ts`
- [x] T013 DAO: recoverExpiredLeases 保守回收（仅 in_flight + attempt_id 未变化；不得回收终态）：`packages/agent-remnote/src/internal/queue/dao.ts`
- [x] T014 (Recommended) Schema: 新增 `op_attempts` 表保存 attempt 历史（op_id+attempt_id 为主键；含 conn_id/status/detail_json/created_at），并完成迁移：`packages/agent-remnote/src/internal/queue/{schema.sql,db.ts}`
- [x] T015 (Recommended) DAO: 在 claim/ack/recover 关键路径写入 `op_attempts`（用于多客户端排障与审计）：`packages/agent-remnote/src/internal/queue/dao.ts`
- [x] T016 DAO: `id_map` 不可漂移（冲突 fail-fast，且不得覆盖已有映射）：`packages/agent-remnote/src/internal/queue/dao.ts` + `packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`

## Phase 2: WS protocol + bridge

- [x] T020 Protocol doc: attempt_id/AckRejected/LeaseExtend（更新 SSoT，breaking）：`docs/ssot/agent-remnote/ws-bridge-protocol.md`
- [x] T021 Bridge runtime: OpDispatch/OpAck/AckOk 增加 attempt_id；stale ack 返回 AckRejected：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`
- [x] T022 Legacy bridge: 同步更新 internal bridge（如仍在用）：`packages/agent-remnote/src/internal/ws-bridge/bridge.ts`

## Phase 3: Plugin ack reliability

- [x] T030 Plugin: 维护 pendingAcks（内存 + 可选持久化）并在未收到 AckOk 前重试发送：`packages/plugin/src/bridge/runtime.ts`
- [x] T031 Plugin: 处理 AckRejected（stale）为可诊断事件（避免 toast 风暴，必要时 silent）：`packages/plugin/src/bridge/runtime.ts`
- [x] T032 Plugin: dedup 返回一致 result（含 created/id_map），避免 012 的映射缺失：`packages/plugin/src/bridge/ops/executeOp.ts` + handlers

## Phase 4: Tests

- [x] T040 Contract: stale ack 被拒绝且不回滚终态：`packages/agent-remnote/tests/contract/**`
- [x] T041 Integration-ish: 多客户端接管 + lease 过期 + 旧回执迟到（TestClock）：`packages/agent-remnote/tests/integration/**`
- [x] T042 Contract: `id_map` 漂移被拒绝且保留原映射：`packages/agent-remnote/tests/contract/queue-id-map-no-drift.contract.test.ts`

## Phase 5: Doc sync（实现落地后）

- [x] T050 更新队列 schema SSoT：`docs/ssot/agent-remnote/queue-schema.md`
- [x] T051 更新 tools-write（涉及 012 的 id_map/idempotency 语义）：`docs/ssot/agent-remnote/tools-write.md`
