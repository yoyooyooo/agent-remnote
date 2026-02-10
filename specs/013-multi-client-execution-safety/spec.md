# Spec 013：多客户端执行安全（回执一致性 + 重放控制）

**Date**: 2026-01-25  
**Status**: Accepted  
**Accepted**: 2026-01-25  
**Scope**: write queue + WS bridge + plugin executor  

全局概念与术语裁决见：`specs/CONCEPTS.md`（Data Plane：attempt_id/CAS ack、id_map 不漂移、WS Protocol v2 合并升级）。

## Input（用户期望）

当 RemNote 存在多个客户端实例（例如桌面端 + 网页端，或多窗口）并来回切换时，agent 在写入队列期间：

1) 队列消费不会因竞态/时序导致“写入丢失、回执覆盖、状态回滚、映射漂移”。  
2) active worker 迁移（最近会话唯一消费）不会引入“重复执行同一 op”或“旧回执污染新派发”。  
3) 在断线/重连/崩溃/lease 过期等异常下，系统保持可恢复且可诊断；允许 at-least-once，但必须把“重复执行”的概率降到极低，并保证队列状态单调与可证明正确。  

## Context

在以下特性全部落地后，本问题将成为主风险集中点：

- 009：Effect Native（可取消/可测试的长驻 runtime Actor）。  
- 011：write-first + 命令收口（默认 notify/ensure-daemon，链路更短、写入更频繁）。  
- 012：batch write plan（alias/@ref + id_map 替换，依赖“结果与映射稳定性”）。  
- 010（计划）：批量拉取 + 冲突感知调度（吞吐更高、并发更大）。  

其中 003/004 已提供 active worker 与 kick/quarantine 的基础，但目前缺少“回执必须绑定派发尝试”的硬不变量（见本 spec）。

## 重要裁决：先固化 Data Plane 不变量，再由 010 收口 WS Protocol v2

本 spec 负责 Data Plane 的一致性不变量（attempt_id + CAS ack + 终态不可回滚 + id_map 不漂移 + ack 重试）。

WS Protocol v2（`Register.protocolVersion=2` + `RequestOps/OpDispatchBatch`）由 010 在一次 breaking 升级中收口实现，并继承本 spec 的 attempt_id/CAS ack 语义。

## Goals

- G1：**OpAck 落库必须满足强一致性校验**：只允许确认“当前这一次派发尝试”，旧回执不得污染新派发。  
- G2：**op 状态流转单调**：终态（`succeeded/dead`）不可被迟到回执回滚。  
- G3：**显式 attempt/dispatch token**：每次 claim（`pending -> in_flight`）生成 `attempt_id`（或等价 token），贯穿 DB 与 WS 协议。  
- G4：**减少重复执行窗口**：通过 ack 重试/续租/断线恢复把“执行成功但 ack 丢失导致重放”的概率降到极低。  
- G5：**对 012 的 id_map 语义提供硬保障**：重放/重复确认不会导致 `client_temp_id -> remote_id` 漂移；dedup 路径能返回一致结果（含 `created/id_map`）。  

## Non-goals

- 不承诺跨客户端（桌面+网页）在“执行成功但彻底失联且无任何可恢复证据”的极端场景下做到严格 exactly-once。  
- 不引入网络层鉴权/加密（仍在 localhost 信任边界内）。  
- 不要求兼容旧协议（forward-only）。  

## Key Decisions（核心不变量）

1) **attempt_id（派发尝试标识）**  
   - 任何一次 claim 都必须生成新的 `attempt_id` 并写入 ops 行。  
   - WS 派发 item（当前 `OpDispatch`；后续 v2 为 `OpDispatchBatch.ops[]`）必须带 `attempt_id`；插件 `OpAck` 必须回传 `attempt_id`。  

2) **CAS ack（回执落库必须命中当前尝试）**  
   - ackSuccess/ackRetry/ackDead 必须具备条件：`status='in_flight' AND locked_by=<connId> AND attempt_id=<attemptId>`。  
   - 若不命中：返回“Rejected/StaleAck”，并不得修改 ops/op_results/id_map。  

3) **终态不可回滚**  
   - `succeeded/dead` 一旦写入，不得被任何后续 ack 或 lease 回收改回 `pending`。  

4) **lease 回收保守**  
   - lease 回收必须不会把终态回收为 pending；回收的对象必须仍为 `in_flight` 且 attempt 未被更新。  
   - 回收必须写入可诊断信息（attempt_id、locked_by、原因、时间）。  

5) **AckOk 语义升级**  
   - server 返回 `AckOk` 必须包含 `attempt_id`，用于插件侧确认“回执已被接收并落库”。  
   - 插件必须实现 ack 重试：在未收到 AckOk 前重试发送 OpAck（含 attempt_id）。  

## Scenarios & Testing（SC；必须可验证）

### SC-001：两客户端在线，active worker 切换不污染回执（P1）

1. A 为 active worker，claim op（attempt=A1）并开始执行。  
2. 切换到 B，active worker 迁移；A 断线或 lease 过期导致 op 被回收并再次 claim（attempt=B1）。  
3. A 的迟到 OpAck(attempt=A1) 到达：必须被拒绝（stale），不得改变 DB。  
4. B 的 OpAck(attempt=B1) 成功确认：op 进入 succeeded（或 retry/dead）。  

### SC-002：ack 丢失可恢复（P1）

1. 插件执行成功后发送 OpAck，但在收到 AckOk 前断线。  
2. 重连后插件重发 OpAck（相同 attempt_id）。  
3. server 以幂等方式返回 AckOk；队列不发生重放。  

### SC-003：id_map 不漂移（P1）

1. create 类 op 返回 `created/id_map`，写入 `id_map(client_temp_id -> remote_id)`。  
2. 任何重复 ack / 重放尝试不得覆盖已存在映射；如发现冲突必须 fail-fast 并可诊断。  

## Requirements

### Functional Requirements

- FR-001：队列 schema 必须支持 attempt_id（见 data-model）。  
- FR-002：WS 协议必须在 `OpDispatch*.attempt_id` / `OpAck.attempt_id` / `AckOk.attempt_id` / `AckRejected.attempt_id` 中携带并校验 attempt_id（forward-only）；v2 升级（`protocolVersion=2` + batch pull）由 010 收口落地。  
- FR-003：ack 落库必须做 CAS 校验（命中当前 in_flight attempt）；否则拒绝。  
- FR-004：插件必须实现 AckOk 驱动的 ack 重试（断线/重连后可继续 flush）。  
- FR-005：lease 回收与重派发必须生成新 attempt_id；回收不得影响终态。  
- FR-006：当检测到映射冲突（同 client_temp_id 映射到不同 remote_id）时，必须输出稳定错误码 + 可行动 nextActions。  

### Non-Functional Requirements

- NFR-001：所有拒绝/冲突必须可诊断：输出 attempt_id/connId/op_id/原因。  
- NFR-002：测试必须可确定性：优先用 TestClock/可控 runtime，避免 flaky。  

## Deliverables（落地点）

- 新增/更新：`specs/013-multi-client-execution-safety/{spec.md,data-model.md,plan.md,tasks.md,quickstart.md}`  
- 实现（后续任务）：队列 DAO（claim/ack/recover）、WS bridge 协议、插件 ack 重试与可选续租、集成/契约测试。  
