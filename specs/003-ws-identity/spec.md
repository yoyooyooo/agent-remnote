# Spec 003：WS 连接实例标识与活跃会话选举（移除 `consumerId`）

**Date**: 2026-01-24  
**Status**: Accepted  
**Accepted**: 2026-01-26  

关联需求：

- 同步可靠性（默认 ensure/notify + 可观测进度）：`specs/004-sync-reliability/spec.md`
- 安全搜索（read-rpc/候选集）：`specs/005-search-safety/spec.md`

## Input（用户期望）

1) **彻底移除 `consumerId`**：它来自可共享配置（Settings/Local Storage），用户默认不会去改，无法稳定区分不同客户端/窗口/设备；保留它只会误导设计与排障。  
2) **用服务端 `connId` 区分连接实例**：每条 WS 连接在服务端有唯一 `connId`，可用于路由、诊断与锁归属。  
3) **只允许“最近使用过的会话”消费队列**：用插件推送的 `uiContext/selection` 作为活跃度信号，由服务端选举 active worker；其它连接不得消费。  
4) 为 read-rpc/阻塞式 RPC 提供稳定的“请求关联与回包路由”基础能力（不同命令并发不串包）。  

## 背景 / 现状

- 当前协议把 `consumerId` 当作“消费组”，用于：
  - worker 互斥（同一 `consumerId` 只允许一个连接 `RequestOp`）；
  - `StartSync` 定向（`TriggerStartSync(consumerId)`）；
  - `ops.locked_by` 记录为 `consumerId`。
- 但 `consumerId` 来自可共享/可忽略的配置，无法表达“连接实例是谁”，也无法表达“哪一个会话最近使用”；会造成：
  - 多窗口/多端行为不确定（`worker_busy`、定向不准、难以接管）；
  - read-rpc 设计被迫绕开“实例”概念；
  - 让用户背锅（要求用户去改一个本不该改的 id）。

## 目标（Goals）

- G1：协议与实现中不再出现 `consumerId`（消息/配置/日志/状态文件/排障文档）。  
- G2：服务端为每条连接分配 `connId`，并在 `Clients`/state file 中可见。  
- G3：插件为每个运行实例生成 `clientInstanceId`（自动、无需用户配置），并在注册时上报；用于跨重连的诊断与归因。  
- G4：服务端基于 `uiContext.updatedAt` / `selection.updatedAt` 选举 **active worker**；`lastSeenAt` 仅用于 stale 过滤；只有 active worker 能消费队列。  
- G5：为 read-rpc 提供“请求-响应”关联：以 `(callerConnId, requestId)` 或等价机制隔离并发请求，保证不串包。  

## 非目标（Non-goals）

- 不做网络层鉴权/加密（仍假设本机 localhost 信任边界）。  
- 不追求向后兼容旧协议（仓库采用 forward-only evolution）。  
- 不追求多 worker 并发消费（本 spec 默认单 active worker，保证写入行为更可预期）。  

## User Scenarios & Testing（SC；必须可验证）

### SC-001：多窗口/多端，最近会话唯一消费（P1）

**Independent Test**：

1. 同时打开两个 RemNote 窗口（均连接 WS）。  
2. 在窗口 A 中产生 UI 活动（selection/uiContext 更新），服务端选举 A 为 active worker。  
3. A 发 `RequestOp` 可取到任务；窗口 B 发 `RequestOp` 只能得到 `NoWork(reason='not_active_worker')`。  
4. 切换到窗口 B 操作后，active worker 迁移到 B（无需改任何配置）。  

### SC-002：active worker 掉线可接管（P1）

**Independent Test**：

1. active worker 连接断开或 stale（超过阈值）。  
2. 服务端自动选举下一候选连接接管；队列继续被消费。  

### SC-003：read-rpc 并发隔离（P1）

**Independent Test**：

1. 同一 CLI 进程并发发起两次 read-rpc（不同 requestId）。  
2. 插件按任意顺序回包；服务端必须按 requestId 回到正确的 callerConnId，不串包。  

## Functional Requirements

- **FR-001**：WS 协议 MUST 移除 `consumerId`（`Register`/`RequestOp`/`TriggerStartSync`/`YouAre`/`Clients` 等不再包含该字段）。  
- **FR-002**：服务端 MUST 为每条 WS 连接分配 `connId`（随机 UUID 或等价不可预测 id），并在握手/注册 ack 中返回给客户端。  
- **FR-003**：客户端（插件）MUST 提供 `clientInstanceId`（自动生成并本机持久化），并在注册时上报；服务端在 `Clients`/state file 中透出。  
- **FR-004**：服务端 MUST 维护 active worker 选举：候选集合=“声明可作为 worker 的连接”；择优依据 `max(uiContext.updatedAt, selection.updatedAt)`；`lastSeenAt` 仅用于 staleness 阈值过滤（避免心跳导致选举抖动）。  
- **FR-005**：`RequestOp` MUST 仅对 active worker 生效；非 active worker 返回 `NoWork(reason='not_active_worker')`（可附带 `activeConnId` 便于诊断）。  
- **FR-006**：`TriggerStartSync` MUST 默认只触发 active worker；若无 active worker，返回 `sent=0` 并给出建议型 nextActions（例如“切到目标窗口触发一次 selection 更新/检查控制通道连接”）。  
- **FR-007**：队列 op 的锁归属（`ops.locked_by`）MUST 写入 `connId`（而非 `consumerId`），便于精确诊断与接管。  
- **FR-008**：WS 状态查询与 state file MUST 包含：`connId`、`clientInstanceId`、`isActiveWorker`、`lastUiContextAt/lastSelectionAt/lastSeenAt`（或等价字段）。  
- **FR-009**：read-rpc MUST 使用 `connId` 做路由，并以 `(callerConnId, requestId)`（或等价）做关联隔离。  
- **FR-010**：文档与 Skill MUST 同步更新：移除 `consumerId` 的用户配置/排障口径，替换为 “active worker/connId” 的解释与建议动作。  

## Non-Functional Requirements

- **NFR-001**：系统 MUST 不要求用户配置任何“实例标识”（`connId` 由服务端分配；`clientInstanceId` 由插件自动生成并本机持久化）。  
- **NFR-002**：active worker 选举 MUST 稳定：`lastSeenAt` 仅用于 stale 过滤，不得参与排序（避免心跳导致选举抖动）。  

## Deliverables（交付物）

- `docs/ssot/agent-remnote/ws-bridge-protocol.md`：更新为无 `consumerId` 的协议定义。  
- 代码：`packages/agent-remnote/src/internal`（bridge/queue）、`packages/plugin`（注册与 worker）、`packages/agent-remnote`（CLI 配置与 ws 命令）完成迁移。  
- 草案与迁移说明：`docs/proposals/agent-remnote/ws-bridge-protocol-vnext.md`。  
