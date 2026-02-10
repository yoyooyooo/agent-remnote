# 特性规格：WS 背压预算（maxBytes）+ Lease 策略/续租（降低重派发与重复副作用窗口）

**特性分支**: `[015-ws-backpressure-and-lease-extension]`  
**创建日期**: 2026-01-26  
**状态**: Accepted  
**Accepted**: 2026-01-26  
**输入**: 用户描述：“插件侧会被通知到，但可能在忙别的而卡很久；希望在不牺牲可靠性的前提下把同步链路变得更稳，避免大 payload 导致断线，以及 lease 过期导致重派发/重复副作用。”

全局概念与术语裁决见：`specs/CONCEPTS.md`（Control/Data/UX planes、WS Protocol v2、attempt_id/CAS ack、lease、id_map 不漂移）。

## 背景与动机

在 010/013 已落地的基线下：

- 010 提升吞吐：批量拉取 `RequestOps/OpDispatchBatch` + 冲突感知调度。
- 013 钉死一致性：`attempt_id + CAS ack` 防 stale ack 污染；终态不可回滚；`id_map` 不漂移。

但仍存在两类“放大器”会把链路推向断线/重派发/重复副作用：

1) **批量帧体积不可控**：仅限制 `maxOps` 时，单 op 的 `payload` 变大（大 markdown、表格批量、长文本）会导致 `OpDispatchBatch` 单帧过大，引发 WS 卡顿/断线。
2) **执行时间不可控**：插件可能在 UI/SDK 忙碌时延迟执行/回执，固定 lease 容易过期；过期回收会导致重派发。`attempt_id` 能防状态回滚，但无法消除“副作用重复执行”（尤其 create/append）。

本 spec 的目标是把这两类放大器变成“有界 + 可诊断 + 可收敛”的行为。

## Scope

### In Scope

- WS v2 的 **背压预算升级**：`RequestOps` 支持 `maxBytes`（以及可选 `maxOpBytes`）；服务端必须强制预算（client 仅是建议）。
- `OpDispatchBatch` 返回 **预算诊断字段**（budget/统计），让 CLI/Agent 能从一次输出定位“为何派发变少/为何跳过”。
- **超预算单 op 的收敛策略**：明确“单条 op 太大”时如何 fail-fast 并避免后台抖动（无限 claim→失败→claim）。
- **lease 策略升级**：服务端对 `leaseMs` 做 clamp，并引入按 `op_type`/payload 规模的动态 lease（至少覆盖最常见的长 op）。
- **续租（LeaseExtend）落地**：插件在执行长 op 时可发送 `LeaseExtend`（携带 `op_id/attempt_id`），服务端仅在命中当前 in-flight attempt 时延长 `lease_expires_at`。

### Out of Scope（v1）

- 引入网络鉴权/加密（仍在 localhost 信任边界内）。
- 为旧协议/旧插件提供长期兼容层（forward-only：允许 breaking，但必须 fail-fast + 可诊断）。

## 依赖

- **010-batch-pull-conflict-scheduler**：已有 WS Protocol v2 与调度器；本 spec 补齐其 FR-008/FR-009 的缺口（maxBytes/lease 策略）。
- **013-multi-client-execution-safety**：`attempt_id/CAS ack` 与终态单调是 lease/续租的正确性地基。
- **011/012（可选）**：若在“入队侧”增加 payload size guard/自动拆分（减少超大 op 进入队列），需与 write-first/plan 输出契约对齐。

## 用户场景与测试（必填）

### 用户故事 1：大 payload 不再导致断线（P0）

作为用户/智能代理，当队列中存在大 payload 的 op（例如写入长 markdown）时，系统仍应稳定派发并执行：

- 服务端不会发送超过预算的 `OpDispatchBatch`（`maxBytes`）。
- 若单条 op 超过 `maxOpBytes`（或超过系统硬上限），系统会 fail-fast 并给出可行动 nextActions，而不是无限抖动。

### 用户故事 2：插件忙碌/执行很慢时，不要过早回收重派发（P0）

作为用户/智能代理，当插件因为 UI/SDK 忙碌导致执行/回执变慢时：

- lease 默认策略应足够覆盖常见慢 op；
- 对真正长 op，插件可以续租，服务端在命中 attempt 的前提下延长 lease；
- 断线/迁移场景下仍保持 013 的一致性不变量（stale ack 被拒绝、终态不回滚、id_map 不漂移）。

### 用户故事 3：可诊断（P1）

作为维护者，我希望从一次输出中定位“派发变少/跳过”的原因：

- budget（请求/生效/被 clamp）
- skipped 的计数与原因（over_budget / oversize_op / conflict 等）
- nextActions（英文命令）指导下一步行动（inspect/abort/split/降低并发等）。

## 需求（必须）

### 功能需求（FR）

- **FR-001**：`RequestOps` MUST 支持 `maxBytes`（可选 `maxOpBytes`）；服务端必须对其做 clamp（含最小/最大值）。
- **FR-002**：服务端 MUST 确保每个 `OpDispatchBatch` 的近似字节预算不超过 `maxBytesEffective`。
- **FR-003**：`OpDispatchBatch` SHOULD 携带 budget 诊断字段（请求值、clamp 后值、实际估算值、skipped 统计）。
- **FR-004**：当发现单条 op 超过 `maxOpBytesEffective`（或系统硬上限）时，系统 MUST 收敛到可行动终局：
  - 给出稳定错误码（例如 `OP_PAYLOAD_TOO_LARGE`）与可复制 nextActions；
  - 并避免后台无限重试/抖动（例如将该 op/txn 标记为 failed/dead 或隔离到人工处理队列）。
- **FR-005**：服务端 MUST 对 `leaseMs` 做 clamp，并引入动态 lease（至少按 `op_type` 与 payload 大小）。
- **FR-006**：协议 MUST 支持 `LeaseExtend`；服务端 MUST 仅在命中当前 in-flight attempt（`locked_by + attempt_id`）时更新 `lease_expires_at`，否则返回可诊断拒绝。

### 非功能需求（NFR）

- **NFR-001**：所有新诊断字段必须可机器解析（`--json` 模式 stdout 纯净，额外信息进 envelope 字段/或 stderr）。
- **NFR-002**：在 backlog=10k 场景下仍可用：预算装箱/扫描必须有上限并可降级（避免 O(n) 扫描）。
- **NFR-003**：forward-only：协议/字段升级必须 fail-fast + nextActions（不保留长期兼容层）。

## 成功标准（必填）

- **SC-001**：在包含大 payload 的批量写入场景下，不出现“大帧导致断线”的系统性问题；且有集成测试证明 batch 字节预算约束成立。
- **SC-002**：在“执行慢/回执慢”场景下，lease 不会过早回收导致重派发；在需要时可通过续租覆盖长 op（含测试）。
- **SC-003**：当发生 oversize op 时，系统一次输出即可指导用户采取最短可行动修复路径（inspect/abort/split/retry）。
