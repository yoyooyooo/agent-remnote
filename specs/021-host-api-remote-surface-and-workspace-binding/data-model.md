# Data Model: 021-host-api-remote-surface-and-workspace-binding

## 1. Workspace Binding（Store DB）

用途：把 `workspaceId -> dbPath` 的长期关系持久化，作为 DB read 的第一事实源。

建议表：`workspace_bindings`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `workspace_id` | TEXT PRIMARY KEY | RemNote workspace / kb 标识 |
| `kb_name` | TEXT | 最近一次从 UI context 观察到的 KB 名称 |
| `db_path` | TEXT NOT NULL | 绑定到的本地 `remnote.db` 绝对路径 |
| `source` | TEXT NOT NULL | `explicit` / `live_ui_context` / `single_candidate_auto` / `deep_link` |
| `is_current` | INTEGER NOT NULL | 是否为当前默认 workspace，0/1 |
| `first_seen_at` | INTEGER NOT NULL | 首次建立 binding 的时间 |
| `last_verified_at` | INTEGER NOT NULL | 最近一次验证 `db_path` 仍存在的时间 |
| `last_ui_context_at` | INTEGER | 最近一次由 live UI context 刷新的时间 |
| `updated_at` | INTEGER NOT NULL | 最近一次写入该 binding 的时间 |

约束：

- 任一时刻最多只有一个 `is_current = 1`
- `workspace_id` 一旦存在，更新必须保留 `first_seen_at`
- 若 `db_path` 发生变化，必须更新 `source` 与 `last_verified_at`

## 2. Workspace Candidate（运行时枚举，不持久化为长期事实）

用途：当系统缺少显式 workspace / binding / live `kbId` 时，对 `~/remnote/` 做候选扫描。

运行时结构：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `workspaceId` | string | 由目录名 `remnote-<workspaceId>` 提取 |
| `dbPath` | string | 候选 DB 绝对路径 |
| `kind` | string | `primary` / `secondary` |
| `dirName` | string | 原始目录名 |
| `mtimeMs` | number | 文件修改时间，用于候选排序 |

说明：

- `primary` 指 `remnote-<workspaceId>` 目录
- `secondary` 指 `remnote-browser` / `lnotes` 等兼容目录
- 多候选时仅用于诊断输出与人工确认，不得写入长期 binding

## 3. Workspace Resolution（统一解析结果）

用途：所有依赖 DB 解析的 use case / 命令都只消费这一种结果结构。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `resolved` | boolean | 是否得到确定性 workspace / dbPath |
| `workspaceId` | string | 解析出的 workspace |
| `dbPath` | string | 解析出的 DB 路径 |
| `source` | string | `explicit` / `binding` / `live_ui_context` / `single_candidate_auto` / `unresolved` |
| `kbName` | string? | 若已知则带上 |
| `candidates` | WorkspaceCandidate[] | unresolved 或诊断时返回 |
| `reasons` | string[] | 诊断原因 |

优先级：

1. 显式 `workspaceId`
2. deep link 的 `workspaceId`
3. 已持久化 binding
4. live `uiContext.kbId`
5. 唯一 primary 候选自动采用
6. unresolved

## 4. Host API Capability State

用途：让远程调用方在调用业务端点前判断 readiness。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `db_read_ready` | boolean | 当前是否已解析到可读 DB |
| `plugin_rpc_ready` | boolean | 当前 active worker / readRpc 是否可用 |
| `write_ready` | boolean | 当前 queue + daemon + active worker 是否满足写入闭环 |
| `ui_session_ready` | boolean | 当前是否有可用 UI context / selection 基础 |

建议附带明细：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `workspace` | object | 当前 workspace 解析详情 |
| `plugin` | object | active worker、ws、readRpc 状态 |
| `write` | object | daemon、queue、worker readiness |
| `ui_session` | object | `uiContext` / `selection` 是否可读 |

## 5. `api.state.json`（运行时快照）

用途：保留 API 进程级 snapshot，不承担长期 binding 持久化。

建议字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `running` | boolean | API 是否运行中 |
| `pid` | number | 进程号 |
| `host` | string | 监听 host |
| `port` | number | 监听端口 |
| `basePath` | string | 当前 API base path |
| `startedAt` | number | 启动时间 |
| `localBaseUrl` | string | 本机推荐访问地址 |
| `remoteBaseUrl` | string? | 若可推导，则给出通用远程地址建议 |
| `containerBaseUrl` | string? | 保留兼容诊断用途 |
| `daemon` | object | daemon / ws 健康状态 |

## 6. 状态接口建议输出骨架

```json
{
  "service": {
    "running": true,
    "pid": 12345,
    "base_url": "http://127.0.0.1:3000",
    "base_path": "/v1"
  },
  "capabilities": {
    "db_read_ready": true,
    "plugin_rpc_ready": true,
    "write_ready": true,
    "ui_session_ready": true
  },
  "workspace": {
    "resolved": true,
    "workspace_id": "60810ee78b0e5400347f6a8c",
    "kb_name": "yoyooyooo",
    "db_path": "/Users/yoyo/remnote/remnote-60810ee78b0e5400347f6a8c/remnote.db",
    "source": "binding",
    "candidate_workspaces": []
  },
  "plugin": {
    "active_worker_conn_id": "..."
  }
}
```

## 7. 关键错误码

| 错误码 | 场景 |
| --- | --- |
| `WORKSPACE_UNRESOLVED` | 多候选且没有确定性信号，无法解析当前 DB |
| `DB_UNAVAILABLE` | workspace 已解析，但 DB 不存在或不可读 |
| `PLUGIN_UNAVAILABLE` | 需要 plugin / readRpc，但当前无 active worker |
| `WRITE_UNAVAILABLE` | queue / daemon / active worker 无法形成写入闭环 |
| `UI_SESSION_UNAVAILABLE` | 需要 UI context / selection，但当前会话不可用 |

## 8. Endpoint Binding Scope Matrix

目的：避免所有端点统一前置 workspace resolver。

### A. `no_binding`

这类端点不依赖 workspace binding，也不需要解析本地 DB。

建议包含：

- `GET /health`
- `GET /status` 的进程级存活部分
- `POST /queue/wait`
- `GET /queue/txns/:txnId`
- `POST /actions/trigger-sync`
- 纯 `write/apply`，前提是请求体不要求服务端做基于本地 DB 的 ref 解析

### B. `binding_snapshot_only`

这类端点需要知道当前 workspace / capability 状态，但不需要每次真的打开 DB。

建议包含：

- `GET /status`
- `api status`
- `stack status`

返回重点：

- `currentWorkspaceId`
- `bindingSource`
- `resolved`
- `candidateWorkspaces[]`
- capability flags

### C. `db_resolver_required`

这类端点必须拿到确定性的 `workspaceId + dbPath`，必要时才能打开 DB。

建议包含：

- `POST /search/db`
- `POST /read/outline`
- `GET /daily/rem-id`
- 任何需要解析 `page:` / `title:` / `daily:` / deep link workspace 的接口
- 任何为了补标题、补页面上下文而必须读本地 DB 的接口

实现约束：

- 只有这类端点才允许调用 `workspaceResolver`
- resolver 可以复用 binding snapshot，但不得把“打开 DB”前置到所有请求
