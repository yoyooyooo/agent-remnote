# HTTP API Contract: 019-local-host-api-and-stack

Base URL（宿主机内）：`http://127.0.0.1:3000`  
Base URL（容器内）：`http://host.docker.internal:3000`

> 说明：服务默认监听 `0.0.0.0:3000`；对容器推荐使用 `host.docker.internal`，对宿主机推荐使用 `127.0.0.1`。

## CLI Remote API Binding

业务 CLI 在 remote API mode 下，通过以下入口绑定到 Host API：

- `--api-base-url http://host.docker.internal:3000`
- `REMNOTE_API_BASE_URL=http://host.docker.internal:3000`
- `~/.agent-remnote/config.json` → `{ "apiBaseUrl": "http://host.docker.internal:3000" }`

该 binding 适用于对等业务能力，不适用于 `api serve/start/stop/status/logs/restart/ensure` 这类 API lifecycle 命令。

## `GET /v1/health`

用途：快速判断 API / daemon / active worker / queue 的最小健康面。

成功示例：

```json
{
  "ok": true,
  "data": {
    "api": { "running": true, "healthy": true },
    "daemon": { "running": true, "healthy": true },
    "activeWorkerConnId": "uuid-or-null",
    "queue": { "pending": 0, "in_flight": 0 }
  }
}
```

## `GET /v1/status`

用途：返回完整聚合状态（含 base URLs / UI state freshness / queue stats / worker info）。

## `GET /v1/ui-context`

用途：返回当前 `kbId / pageRemId / focusedRemId / paneId / focusedPortalId`。

## `GET /v1/selection`

用途：返回当前 selection 快照。

## `POST /v1/search/db`

用途：走宿主机 DB Pull 做只读搜索。

请求示例：

```json
{ "query": "keyword", "limit": 20, "timeoutMs": 30000 }
```

## `POST /v1/search/plugin`

用途：走插件 read-rpc 做 Top-K 候选搜索。

请求示例：

```json
{ "query": "keyword", "limit": 20, "timeoutMs": 3000 }
```

## `POST /v1/write/ops`

用途：入队原子 ops，供容器 agent 发起安全写入。

请求示例：

```json
{
  "ops": [{ "type": "create_rem", "payload": { "parent_id": "id:xxx", "text": "hello" } }],
  "idempotencyKey": "demo:hello"
}
```

## `POST /v1/write/markdown`

用途：提供高频 Markdown 写入便捷入口。

请求示例：

```json
{
  "ref": "page:Inbox",
  "markdown": "- hello\n- world",
  "idempotencyKey": "inbox:demo"
}
```

## `POST /v1/queue/wait`

用途：等待 `txn_id` 到达终态。

请求示例：

```json
{ "txnId": "txn_xxx", "timeoutMs": 30000, "pollMs": 500 }
```

## `GET /v1/queue/txns/:txnId`

用途：查询指定事务状态。

## `POST /v1/actions/trigger-sync`

用途：显式 kick active worker；主要用于诊断与手动收敛。

## 统一约束

- 所有响应体都使用 envelope：`{ ok, data }` 或 `{ ok: false, error }`
- 对外错误文本必须英文。
- 写入类 API 不得绕过 queue / plugin 执行链路。
