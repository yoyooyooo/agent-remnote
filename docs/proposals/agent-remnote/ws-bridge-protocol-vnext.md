# WS Bridge 协议 vNext（草案）：`connId` + active worker + read-rpc（移除 `consumerId`）

> 状态：草案（非 SSoT）。实现与协议落地后，应同步更新 `docs/ssot/agent-remnote/ws-bridge-protocol.md`。
>
> 对应需求：`specs/003-ws-identity/spec.md`（基础）与 `specs/005-search-safety/spec.md`（read-rpc/search）。

## 目标

- 彻底移除 `consumerId`（不再让用户配置“看似重要但实际无用”的 id）。
- 用服务端 `connId` 精确标识“连接实例”，并支持：
  - active worker 选举（最近会话唯一消费）
  - read-rpc 的请求关联与回包路由（不串包）

## 关键概念

- `connId`：服务端为每条 WS 连接生成的实例 id（UUID）。生命周期=单次连接；断线重连会变。
- `clientInstanceId`：插件本地生成并持久化的实例 id（UUID）。生命周期=该插件安装/本机持久；用于跨重连归因。
- **active worker**：由服务端选举的“当前唯一允许消费队列/执行插件侧 read-rpc 的连接实例”。默认规则：选择 `max(uiContext.updatedAt, selection.updatedAt, lastSeenAt)` 最大且不 stale 的候选连接。

## 协议（vNext 形状示意）

所有消息均为 JSON：`{ type: string, ... }`。

### 1) 握手与注册

- Client → Server：`{ "type": "Hello" }`
- Server → Client：`{ "type": "HelloAck", "ok": true, "connId": "<uuid>" }`
- Client → Server：`{ "type": "Register", "clientType": "remnote-plugin" | "cli" | "debug", "clientInstanceId": "<uuid>", "capabilities": { "control": true, "worker": true, "readRpc": true } }`
- Server → Client：`{ "type": "Registered", "connId": "<uuid>" }`

说明：

- `capabilities` 用于限定“是否参与 active worker 候选集”；默认只有 `worker=true` 的连接才会被选为 active worker。
- `clientType` 只用于诊断展示与后续扩展（不作为安全边界）。

### 2) UI 运行态推送（control）

沿用现有 `SelectionChanged/UiContextChanged`，但服务端在内部应更新该连接的活跃度 score，并在必要时触发 active worker 重选。

### 3) 写入消费（worker）

- Client → Server：`{ "type": "RequestOp", "leaseMs": 30000 }`
- Server → Client（非 active worker）：`{ "type": "NoWork", "reason": "not_active_worker", "activeConnId": "<uuid>" }`
- Server → Client（无任务）：`{ "type": "NoWork", "reason": "empty" }`
- Server → Client（有任务）：`{ "type": "OpDispatch", ... }`

说明：

- `ops.locked_by` 应写入 **active worker 的 connId**，便于精确诊断与接管。

### 4) 同步触发（kick）

- Producer/CLI → Server：`{ "type": "TriggerStartSync" }`
- Server → active worker：`{ "type": "StartSync" }`
- Server → Producer/CLI：`{ "type": "StartSyncTriggered", "sent": 1, "activeConnId": "<uuid>" }`

若无 active worker：

- Server → Producer/CLI：`{ "type": "StartSyncTriggered", "sent": 0, "reason": "no_active_worker", "nextActions": ["切到目标 RemNote 窗口触发一次选区/焦点变化", "检查插件控制通道是否已连接"] }`

### 5) read-rpc（示例：插件候选集搜索）

约束：所有 read-rpc 都必须是“预算化”的（超时/limit/payload 截断），避免阻塞 UI。

- Caller（CLI）→ Server：`{ "type": "SearchRequest", "requestId": "<uuid>", "queryText": "<richtext-or-string>", "limit": 20, "timeoutMs": 3000 }`
- Server → active worker：`{ "type": "SearchRequest", "requestId": "<uuid>", "queryText": "...", "limit": 20, "timeoutMs": 3000 }`
- active worker → Server：`{ "type": "SearchResponse", "requestId": "<uuid>", "ok": true, "results": [ ... ], "truncated": false }`
- Server → Caller：`{ "type": "SearchResponse", "requestId": "<uuid>", "ok": true, ... }`

错误/超时：

- 若 active worker 不存在/超时：服务端向 Caller 返回 `SearchResponse(ok=false, errorCode='TIMEOUT'|'NO_ACTIVE_WORKER', nextActions=[...])`
- 服务端必须用 `(callerConnId, requestId)`（或内部 rpcId）关联请求与回包，避免并发串包。

### 6) 状态查询（诊断）

- Client → Server：`{ "type": "QueryClients" }`
- Server → Client：`{ "type": "Clients", "clients": [ { "connId": "...", "clientInstanceId": "...", "clientType": "...", "capabilities": {...}, "isActiveWorker": true, "lastSeenAt": 0, "selection": {...}, "uiContext": {...} } ] }`

## 迁移说明（forward-only）

- 移除：`consumerId`（协议字段、插件本地生成逻辑、CLI flags/env、排障文档口径）。
- 新增：`connId/clientInstanceId` 与 active worker 选举；`NoWork.reason` 从 `worker_busy` 演进为 `not_active_worker`（或等价）。
