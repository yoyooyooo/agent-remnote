# Acceptance: 010-batch-pull-conflict-scheduler

Date: 2026-01-26  
Spec: `specs/010-batch-pull-conflict-scheduler/spec.md`

本验收按 “上帝视角” 覆盖 `spec.md` 内全部带编码点：FR / NFR / SC，并给出漂移/缺口矩阵与 Next Actions。

## 覆盖矩阵

### 功能需求（FR）

| ID | 结论 | 证据（实现/测试） | 备注 |
| --- | --- | --- | --- |
| FR-001 | ✅ Done | WS v2：`RequestOps` / `OpDispatchBatch`（`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts` + `packages/plugin/src/bridge/runtime.ts`） | 协议已在 SSoT 固化 |
| FR-002 | ✅ Done | legacy `RequestOp` fail-fast + `Error.code=WS_PROTOCOL_LEGACY_REQUEST_OP`（`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts` + `packages/agent-remnote/tests/contract/ws-protocol-legacy-requestop.contract.test.ts`） | forward-only ✅ |
| FR-003 | ✅ Done | 调度器：peek→pick→claim→dispatch（`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`） | 依赖 DAO gating |
| FR-004 | ✅ Done | 冲突键不相交批次选择（`packages/agent-remnote/src/kernel/conflicts/*` + `packages/agent-remnote/tests/unit/scheduler-selection.unit.test.ts`） | 贪心策略 |
| FR-005 | ✅ Done | txn 顺序与单 txn 单 in_flight（DAO gating：`peekEligibleOps`/`claimOpById`/`claimNextOp`；以及 scheduler usedTxnIds） | 由 DB + 选择层双保险 |
| FR-006 | ✅ Done | `agent-remnote queue conflicts`（`packages/agent-remnote/src/commands/queue/conflicts.ts`）+ contract test（`packages/agent-remnote/tests/contract/queue-conflicts.contract.test.ts`） | 输出含 nextActions/warnings（英文） |
| FR-007 | ✅ Done | `daemon sync` 输出冲突安全提示：`packages/agent-remnote/src/commands/ws/sync.ts` + contract test：`packages/agent-remnote/tests/contract/daemon-sync-conflicts.contract.test.ts` | 默认仅提示不阻断 |
| FR-008 | ⚠️ Partial | `maxOps` 已 clamp（daemon 1..100；plugin 1..50）；未实现显式 `maxBytes` 预算与大帧保护 | 目前依赖 maxOps 上限 |
| FR-009 | ⚠️ Partial | `leaseMs` 由请求携带；未实现“按 op 类型动态 lease 策略/可配置项” | 当前足够支撑 MVP |
| FR-010 | ✅ Done | Queue DB 不可用/不可写诊断（`packages/agent-remnote/src/services/Queue.ts` + 009/010 相关 contract tests） | write-first 证据见 011/009 产物 |
| FR-011 | ✅ Done | `doctor` 覆盖 queue 可写性（`packages/agent-remnote/src/commands/doctor.ts`） | 已在 009/010 任务中勾选 |
| FR-012 | ✅ Done | `attempt_id` 贯穿 dispatch + ack（013 已 Accepted；WS v2 携带 attempt_id） | 013/010 integration tests 覆盖 |
| FR-013 | ✅ Done | usedKeys 包含全局 in_flight keys（`listInFlightOps` + derive keys + usedKeys 注入） | 010 scheduler integration test 覆盖核心语义 |

### 非功能需求（NFR）

| ID | 结论 | 证据（实现/测试） | 备注 |
| --- | --- | --- | --- |
| NFR-001 | ✅ Done | bounded peek（`peekLimit` 50..500）；冲突报告 bounded scan（`--limit` 默认 500） | 限制可配置 |
| NFR-002 | ✅ Done | `--json` 严格 envelope；`queue conflicts` contract test 证明 stderr empty | 通过 `writeSuccess` 保证 nextActions/warnings 不污染 stdout |
| NFR-003 | ✅ Done | 降级开关：`REMNOTE_WS_SCHEDULER=0` 关闭冲突调度并退化为简单 batch pull：`packages/agent-remnote/src/services/{CliConfigProvider.ts,Config.ts}` + `packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts` | 仅用于开发排障 |
| NFR-004 | ✅ Done | `queue conflicts` 与其它命令一致：`nextActions[]` 英文可复制命令 | `packages/agent-remnote/src/services/Queue.ts` |

### 成功标准（SC）

| ID | 结论 | 证据 | 备注 |
| --- | --- | --- | --- |
| SC-001 | ✅ Done (indirect) | 批量拉取生效：插件按并发空槽 `RequestOps`，daemon 返回 `OpDispatchBatch` | 未做真实 “100 ops 计数” 基准测试（可选） |
| SC-002 | ✅ Done | scheduler integration test 证明冲突簇被拆分、非冲突可并发填满 | 以确定性 DB 场景验证 |
| SC-003 | ✅ Done | `queue conflicts` 输出高风险簇（delete+update）+ nextActions | contract test 覆盖 |
| SC-004 | ✅ Done | queue DB 不可写诊断/nextActions 已在 doctor/queue service 落地 | 见 009/010 相关任务 |

## 漂移/缺口矩阵

| 主题 | 期望 | 现状 | 结论 |
| --- | --- | --- | --- |
| 冲突提示自动化（FR-007） | backlog 高且冲突高风险时提示/阻断（可选） | `daemon sync` 在检测到 high-risk cluster 时返回 warnings/nextActions（默认不阻断） | ✅ Done（可选后续加 strict） |
| 字节预算（FR-008） | `maxBytes` + 大帧保护 | 仅 maxOps clamp | 缺口（下一阶段） |
| 动态 lease（FR-009） | 按 op 类型/配置 | 仅请求参数 | 缺口（下一阶段） |
| 降级开关（NFR-003） | 可快速关闭 scheduler | `REMNOTE_WS_SCHEDULER=0` | ✅ Done |

## Next Actions

1) 实现 FR-008：为 `RequestOps` 增加 `maxBytes`（或 daemon 侧估算 `payload_json` 字节预算）并返回 diagnostics（例如 `skipped_bytes`）。  
2) 增强冲突报告：补充“cluster → page/rem 线索”的人类可读提示（可选引入只读 RNDB fallback）。  
