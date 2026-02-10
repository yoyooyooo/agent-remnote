# WS Bridge 协议与插件集成（SSoT）

目标：在不直接写入 RemNote 官方数据库（`remnote.db`）的前提下，通过「队列 SQLite → WS bridge → RemNote 插件（官方 SDK）执行」完成可靠写入；同时把 selection / uiContext 等 UI 运行态推送给后端/Agent，并支持 read-rpc（插件候选集搜索）。

## 边界与组件

- Producer（CLI/服务端/脚本）：把写入意图编码为 op 入队（见 `docs/ssot/agent-remnote/queue-schema.md`）。
- WS bridge（Node，`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`）：对插件/CLI 提供 WebSocket 接口，派发 op、接收回执、维护连接状态并写入 state file。
- Plugin Executor（`packages/plugin`）：运行在 RemNote 客户端内，执行 op 并回执结果；同时推送 selection / uiContext。

## 连接模型（vNext）

- 单一入口：`ws://localhost:6789/ws`（可用 `REMNOTE_WS_PORT`/`REMNOTE_WS_PATH` 覆盖）。
- 每条 WS 连接由服务端分配一个 `connId`（UUID）。断线重连会变化。
- 插件运行实例在本机生成并持久化 `clientInstanceId`（UUID 或等价），用于跨重连诊断归因（无需用户配置）。
- `capabilities` 用于显式声明连接角色：
  - `control`: 是否会上报 selection / uiContext
  - `worker`: 是否参与 active worker 候选集（消费队列/执行 read-rpc）
  - `readRpc`: 是否支持 read-rpc（如 SearchRequest）
  - `batchPull`: 是否支持批量拉取（WS Protocol v2；`RequestOps` / `OpDispatchBatch`）

### Active worker（最近会话唯一消费）

- 候选集合：`capabilities.worker === true` 的连接
- 排序依据：`activityAt = max(selection.updatedAt, uiContext.updatedAt)`（服务端接收消息时写入）
- stale 过滤：`now - lastSeenAt > STALE_MS` 视为 stale（默认 `STALE_MS=90_000`）
- 仅 active worker 允许 `RequestOps` 拉取队列；非 active worker 返回 `NoWork(reason='not_active_worker', activeConnId)`
- active 切换不打断已派发的 in-flight op：已加租约的 op 仍由原连接回 `OpAck`；断线/卡死由租约回收兜底（见队列 schema）。

## 消息协议

所有业务消息均为 JSON：`{ type: string, ... }`；另有轻量保活：客户端可发纯文本 `"ping"`，服务端回 `"pong"`。

### Error（通用错误）

当服务端/客户端遇到无法处理的请求、协议不匹配、或需要 fail-fast 的一致性冲突时，可发送：

```json
{
  "type": "Error",
  "code": "optional-machine-code",
  "message": "English short sentence",
  "details": { "optional": "json" },
  "nextActions": ["optional", "english", "sentences-or-commands"]
}
```

约束：

- `message` 必须为英文短句（不含堆栈）。
- `code/details/nextActions` 为可选诊断字段；未识别字段的客户端应忽略（forward-only）。

### 1) 基础握手

- Client → Server：`{ "type": "Hello" }`
- Server → Client：`{ "type": "HelloAck", "ok": true, "connId": "uuid" }`

说明：当前版本暂不强制鉴权（保留占位）。

### 2) 注册（声明身份与能力）

- Client → Server：

```json
{
  "type": "Register",
  "protocolVersion": 2,
  "clientType": "remnote-plugin|cli|debug",
  "clientInstanceId": "uuid-or-null",
  "capabilities": { "control": true, "worker": true, "readRpc": true, "batchPull": true }
}
```

- Server → Client：`{ "type": "Registered", "connId": "uuid" }`

### 3) UI 运行态推送（control）

详细字段见：`docs/ssot/agent-remnote/ui-context-and-persistence.md`。

- Client → Server：`SelectionChanged`
- Client → Server：`UiContextChanged`
- Server → Client：
  - `{ "type": "SelectionAck", "totalCount": 3 }`
  - `{ "type": "UiContextAck", "pageRemId": "...", "focusedRemId": "..." }`

#### SelectionChanged（Client → Server）

> 语义与字段映射的权威说明见：`docs/ssot/agent-remnote/ui-context-and-persistence.md`。

- 块级框选（`kind=rem`）：

```json
{
  "type": "SelectionChanged",
  "kind": "rem",
  "selectionType": "Rem",
  "remIds": ["..."],
  "totalCount": 3,
  "truncated": false,
  "ts": 0
}
```

- 文本高亮（`kind=text`，且 `range.start !== range.end`；caret 会被归一化为 `kind=none`）：

```json
{
  "type": "SelectionChanged",
  "kind": "text",
  "selectionType": "Text",
  "remId": "...",
  "range": { "start": 0, "end": 10 },
  "isReverse": false,
  "ts": 0
}
```

### 4) 写入派发（worker）

- Client → Server：`RequestOps`（WS Protocol v2）
  - `{ "type": "RequestOps", "leaseMs": 30000, "maxOps": 4, "maxBytes": 512000, "maxOpBytes": 256000 }`
  - `maxOps` 应与执行器空闲并发槽位匹配（背压）。
  - `maxBytes/maxOpBytes` 用于控制单次 `OpDispatchBatch` 的近似字节预算（避免大帧导致卡顿/断线）。
  - 服务端必须对 `leaseMs/maxOps/maxBytes/maxOpBytes` 做 clamp（server-side 强制），并在 `OpDispatchBatch.budget` 回显 request/effective（便于诊断）。
- Server → Client（有任务）：`OpDispatchBatch`
  - `skipped.depsMissing`：因引用了未解析的 `tmp:*`（缺失 queue_id_map 映射）而暂缓派发的 op 计数（避免无意义重试抖动）。

```json
{
  "type": "OpDispatchBatch",
  "budget": {
    "maxOpsRequested": 4,
    "maxOpsEffective": 4,
    "maxBytesRequested": 512000,
    "maxBytesEffective": 512000,
    "maxOpBytesRequested": 256000,
    "maxOpBytesEffective": 256000,
    "approxBytes": 12345,
    "scanLimit": 200
  },
  "skipped": { "overBudget": 0, "oversizeOp": 0, "conflict": 0, "txnBusy": 0, "depsMissing": 0 },
  "ops": [
    {
      "op_id": "...",
      "attempt_id": "...",
      "txn_id": "...",
      "op_seq": 1,
      "op_type": "create_rem",
      "payload": { "...": "..." },
      "idempotency_key": "...",
      "lease_expires_at": 0
    }
  ]
}
```

- oversize 单 op（`approxBytes(op) > maxOpBytesEffective`）必须收敛为稳定终局（避免无限抖动 claim→失败→claim）：
  - op 应进入 `dead`（并写 `queue_op_results.error_code/error_message`）
  - 同时可对客户端返回 `Error`（稳定 `code` + 英文 `nextActions[]`），用于即时诊断：

```json
{
  "type": "Error",
  "code": "OP_PAYLOAD_TOO_LARGE",
  "message": "Operation payload is too large for dispatch",
  "details": {
    "opId": "...",
    "opBytes": 123456,
    "maxOpBytesEffective": 256000,
    "maxBytesEffective": 512000
  },
  "nextActions": [
    "agent-remnote queue inspect --op <op_id>",
    "Split the write into smaller chunks and re-enqueue",
    "Increase REMNOTE_WS_DISPATCH_MAX_OP_BYTES / REMNOTE_WS_DISPATCH_MAX_BYTES if you own the daemon"
  ]
}
```

- Server → Client（无任务/不可拉取）：
  - `{ "type": "NoWork", "reason": "empty" }`
  - `{ "type": "NoWork", "reason": "not_active_worker", "activeConnId": "uuid-or-null" }`
  - legacy `RequestOp` 会被拒绝（`Error.code=WS_PROTOCOL_LEGACY_REQUEST_OP`），要求升级插件。

- Client → Server：`OpAck`
  - `attempt_id`: `"uuid"`（派发尝试标识；用于 CAS ack，避免 stale 回执污染新派发）
  - `status`: `"success" | "retry" | "failed" | "dead"`
  - `success`: 允许带 `result`（可含 `created` / `id_map` 用于回填 `queue_id_map` 表）
  - `retry/failed/dead`: 使用 `error_code` / `error_message`（以及可选 `retry_after_ms`）
- Server → Client：`{ "type": "AckOk", "ok": true, "op_id": "...", "attempt_id": "..." }`
- Server → Client（stale/invalid 回执被拒绝）：`{ "type": "AckRejected", "op_id": "...", "attempt_id": "...", "reason": "stale_attempt|stale_ack|not_found|..." }`
- Client → Server（可选预留）：`{ "type": "LeaseExtend", "op_id": "...", "attempt_id": "...", "extendMs": 30000 }`
  - 语义：仅允许对“当前 in_flight attempt”（`locked_by + attempt_id`）续租；否则拒绝。
  - 服务端对 `extendMs` 做 clamp（min/max），命中才更新：`lease_expires_at = max(lease_expires_at, now + extendMsEffective)`。
- Server → Client（可诊断响应；客户端可忽略，但建议在被拒绝后停止续租）：
  - `{ "type": "LeaseExtendOk", "ok": true, "op_id": "...", "attempt_id": "...", "lease_expires_at": 0 }`
  - `{ "type": "LeaseExtendRejected", "ok": false, "op_id": "...", "attempt_id": "...", "reason": "stale_attempt|not_found|not_in_flight", "current": { "...": "..." } }`

### 5) 同步触发（notify / kick）

- Producer/CLI → Server：`{ "type": "TriggerStartSync" }`
- Server → Plugin（仅 active worker）：`{ "type": "StartSync" }`
- Server → Producer/CLI：

```json
{
  "type": "StartSyncTriggered",
  "sent": 1,
  "activeConnId": "uuid-or-null",
  "reason": "optional-string",
  "nextActions": ["optional", "english", "sentences"]
}
```

约束：

- 默认只触发 active worker（不再支持/不需要 `consumerId` 定向）。
- 当 `sent=0` 时必须返回可诊断信息与建议型 `nextActions[]`（英文句子）。

### 6) read-rpc：插件候选集搜索

> 用于“探索期”快速候选集；详细策略与预算见 `docs/proposals/agent-remnote/search-strategy.md` 与 `specs/005-search-safety/*`。

#### SearchRequest（Caller → Server）

```json
{
  "type": "SearchRequest",
  "requestId": "uuid",
  "queryText": "string",
  "searchContextRemId": "optional-rem-id",
  "limit": 20,
  "timeoutMs": 3000
}
```

#### SearchResponse（Server → Caller）

```json
{
  "type": "SearchResponse",
  "requestId": "uuid",
  "ok": true,
  "budget": {
    "timeoutMs": 3000,
    "limitRequested": 20,
    "limitEffective": 20,
    "limitClamped": false,
    "maxPreviewChars": 200,
    "durationMs": 120
  },
  "results": [{ "remId": "id", "title": "t", "snippet": "s", "truncated": false }]
}
```

约束：

- 服务端只转发给 active worker 且要求其 `capabilities.readRpc===true`；否则返回 `ok=false`（`NO_ACTIVE_WORKER`）。
- 服务端负责 request/response 关联与超时回收：插件超时/无响应时返回 `TIMEOUT`（建议型 `nextActions[]`）。

### 7) 状态查询（调试/运维）

- Client/CLI → Server：`{ "type": "QueryStats" }` → `{ "type": "Stats", "pending": 0, "in_flight": 0, "dead": 0, "ready_txns": 0 }`（`pending` 仅统计 `txn.status in (ready,in_progress)` 的 pending op）
- Client/CLI → Server：`{ "type": "QueryClients" }` → `{ "type": "Clients", "clients": [...], "activeWorkerConnId": "uuid-or-null" }`
- Client/CLI → Server：`{ "type": "WhoAmI" }` → `{ "type": "YouAre", "connId": "uuid", "clientType": "remnote-plugin|cli|debug", "lastSeenAt": 0 }`

## 可观测性（state file）

WS bridge 会周期性写入“最后快照” state file（默认 `~/.agent-remnote/ws.bridge.state.json`），用于 CLI/脚本/Agent 跨进程读取（非历史事件）。

当前建议 shape 以实现为准（`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`），包含：

- `activeWorkerConnId`
- `clients[]`（含 `connId/clientInstanceId/isActiveWorker/selection/uiContext/lastSeenAt`）
- `kick`（kick 配置与最近一次 kick/dispatch/ack 时间戳，便于诊断“无进展”）

### 生命周期与一致性

- state file 属于 **展示/诊断用快照**，不保证持久存在；读取方必须把“文件不存在”视为 `down`。
- 为避免 tmux/statusline 等展示误显示“还在线”，`agent-remnote daemon stop/restart/status` 可能会主动清理该 state file（以及相关 statusline 工件），以便立刻收敛到真实运行状态。

## 相关指南

- WS 调试与端到端测试：`docs/guides/ws-debug-and-testing.md`
