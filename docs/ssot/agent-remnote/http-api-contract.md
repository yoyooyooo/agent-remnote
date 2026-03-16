# Host API Contract（SSoT）

## TL;DR

- `agent-remnote api serve` 提供本机 Host API（默认 `http://0.0.0.0:3000`）。
- 该 API 默认面向受信宿主机、本地容器与受控远程调用方；当前版本不内建鉴权。
- 若要把 `apiBaseUrl` 暴露给同网段机器、隧道端点或公网调用方，必须先放在显式认证/授权边界之后，例如 Cloudflare Access、反向代理鉴权或等价控制面。`POST /v1/write/apply` 等写端点默认视为敏感面。
- 远程调用方的标准入口是 `apiBaseUrl`；业务 CLI 应保持同一套命令形状，remote API mode 通过用户配置层注入。
- `api` 命令组只负责 API 生命周期；业务命令仍保留原命令名。

## 角色与边界

- `daemon`：继续作为 plugin / WS / queue 的 control plane。
- `api`：对宿主机、本地容器与远程调用方暴露 HTTP/JSON surface。
- `stack`：聚合 `daemon + api` 生命周期。
- 禁止通过 Host API 绕过 `queue -> WS -> plugin SDK` 写入链路。

## 默认监听与访问地址

- Listen host：`0.0.0.0`
- Listen port：`3000`（可由 `PORT` 覆盖）
- 宿主机访问：`http://127.0.0.1:3000`
- 容器访问：`http://host.docker.internal:3000`
- 非默认前缀示例：`http://127.0.0.1:3000/remnote/v1`

## 生命周期命令

- `agent-remnote api serve`
- `agent-remnote api start`
- `agent-remnote api stop`
- `agent-remnote api restart`
- `agent-remnote api ensure`
- `agent-remnote api status`
- `agent-remnote api logs`
- `agent-remnote stack ensure`
  - optional: `--wait-worker --worker-timeout-ms <ms>`
- `agent-remnote stack stop`
- `agent-remnote stack status`

## Remote API Mode

以下业务命令必须支持 remote API mode：

- `search`
- `rem outline`
- `daily rem-id`
- `plugin search`
- `plugin ui-context snapshot/page/focused-rem/describe`
- `plugin current`
  - recommended for agents: `plugin current --compact`
- `plugin selection snapshot/roots/current/outline`
  - recommended for selection-only flows: `plugin selection current --compact`
- `queue wait`
- `apply`
- `rem replace`
- `rem children append`
- `rem children prepend`
- `rem children replace`
- `rem children clear`
- `daily write`

入口：

- 参数：`--api-base-url <url>`
- 环境变量：`REMNOTE_API_BASE_URL=<url>`
- 用户配置文件：`~/.agent-remnote/config.json` 中的 `apiBaseUrl`
- 配置文件路径覆盖：`REMNOTE_CONFIG_FILE=<path>`
- `apiBaseUrl` 可以直接包含前缀路径，例如 `https://host.example.com/remnote/v1`
- 若 `apiBaseUrl` 只提供 origin，则 client 使用 `apiBasePath` 作为默认前缀

优先级：

- `--api-base-url` > `REMNOTE_API_BASE_URL` > `~/.agent-remnote/config.json` > direct mode

严格 remote mode：

- remote mode 的唯一开关是 `apiBaseUrl` 是否存在且有效。
- 一旦配置 `apiBaseUrl`，业务命令必须优先走宿主机 Host API。
- `apiHost`、`apiPort`、`apiBasePath` 只影响服务监听与 URL 解析，不参与业务命令的 mode 判定。
- 仍依赖本地 DB 或本地文件系统的命令必须 fail fast，禁止静默回落到本地读取。
- 若某个业务命令尚无等价 Host API 能力，应返回稳定错误并提示用户在宿主机执行。

## HTTP Endpoints

- `GET /v1/health`
- `GET /v1/status`
- `GET /v1/ui-context`
- `GET /v1/selection`
- `GET /v1/plugin/ui-context/snapshot`
- `GET /v1/plugin/ui-context/page`
- `GET /v1/plugin/ui-context/focused-rem`
- `GET /v1/plugin/ui-context/describe`
- `GET /v1/plugin/selection/snapshot`
- `GET /v1/plugin/selection/roots`
- `GET /v1/plugin/selection/current`
- `GET /v1/plugin/current`
- `GET /v1/daily/rem-id`
- `POST /v1/plugin/selection/outline`
- `POST /v1/read/outline`
- `POST /v1/search/db`
- `POST /v1/search/plugin`
- `POST /v1/write/apply`
- `POST /v1/queue/wait`
- `GET /v1/queue/txns/:txnId`
- `POST /v1/actions/trigger-sync`

## Endpoint Binding Scope

目的：避免所有端点统一前置 workspace binding / DB resolver。

### `no_binding`

这些端点不依赖 workspace binding，也不需要解析本地 DB：

- `GET /v1/health`
- `GET /v1/ui-context`
- `GET /v1/selection`
- `GET /v1/plugin/ui-context/snapshot`
- `GET /v1/plugin/ui-context/page`
- `GET /v1/plugin/ui-context/focused-rem`
- `GET /v1/plugin/selection/snapshot`
- `GET /v1/plugin/selection/roots`
- `POST /v1/search/plugin`
- `POST /v1/queue/wait`
- `GET /v1/queue/txns/:txnId`
- `POST /v1/actions/trigger-sync`
- `POST /v1/write/apply`
  - 前提：`ref` 已经是服务端可解析的稳定目标，且写入链路 capability 已满足

### `binding_snapshot_only`

这些端点需要知道当前 workspace / capability 状态，但不要求每次真的打开 DB：

- `GET /v1/status`
- `agent-remnote api status`
- `agent-remnote stack status`

### `db_resolver_required`

这些端点必须拿到确定性的 `workspaceId + dbPath`，必要时才能打开 DB：

- `POST /v1/search/db`
- `POST /v1/read/outline`
- `GET /v1/daily/rem-id`
- 任何需要解析 `page:` / `title:` / `daily:` / deep link workspace 的等价能力

补充说明：

- `GET /v1/plugin/current`
- `GET /v1/plugin/selection/current`
- `GET /v1/plugin/ui-context/describe`
- `POST /v1/plugin/selection/outline`

这些端点首先依赖 UI session / WS state；当前实现可能在有可用 workspace 时附带做 DB 标题补全，但这属于增强信息，不应被设计成所有请求统一前置 DB 解析。

## Host API write flows

- Host API canonical write route reuses the same enqueue pipeline as the CLI.
- The route accepts the same apply envelope used by `agent-remnote apply --payload`.
- `ensureDaemon=true` means the request may invoke daemon lifecycle helpers before notifying the active worker.
- The runtime must inject daemon runtime services used by enqueue helpers, including `DaemonFiles`, `Process`, and `SupervisorState`.
- Missing daemon runtime services are considered a server bug and must not be silently ignored.

## Command Matrix

### Remote-capable

- `search`
- `rem outline`
- `daily rem-id`
- `plugin search`
- `plugin ui-context snapshot/page/focused-rem/describe`
- `plugin current`
- `plugin selection snapshot/roots/current/outline`
- `queue wait`
- `apply`
- `rem replace`
- `rem children append`
- `rem children prepend`
- `rem children replace`
- `rem children clear`
- `daily write`

### Host-only

- 仍要求直接读取本地 DB 且尚未接到 Host API 的命令
- 仍要求直接读取宿主机文件系统或本地进程状态的命令
- 这类命令在配置 `apiBaseUrl` 后必须 fail fast，并提示用户回到宿主机执行

## Envelope

所有响应都使用与 CLI `--json` 一致的 envelope：

- success: `{ "ok": true, "data": ... }`
- failure: `{ "ok": false, "error": { "code", "message", "details" }, "hint"?: [] }`

## Read Next

- `docs/ssot/agent-remnote/cli-contract.md`
- `docs/ssot/agent-remnote/ws-bridge-protocol.md`
- `docs/ssot/agent-remnote/tools-write.md`
