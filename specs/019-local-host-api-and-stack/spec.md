# 特性规格：本机 Host API + Stack 命令面（宿主机 authoritative runtime，容器内 agent 通过标准入口读写 RemNote）

**特性分支**: `[019-local-host-api-and-stack]`  
**创建日期**: 2026-03-08  
**状态**: Accepted  
**Accepted**: 2026-03-08  
**输入**: 用户描述：“宿主机安装 RemNote，容器内 agent 想读写 RemNote；希望做彻底方案。工具主要用于自己本机使用，不考虑公网/权限复杂度；需要标准化 API，以及 `api serve` / `start` / `stop` / `stack ensure` 这一整套命令面。”

全局概念与术语裁决见：`specs/CONCEPTS.md`（Control/Data/UX planes、WS 协议、队列一致性、CLI envelope 等）。

## 背景与动机

当前 `agent-remnote` 已明确了三件事：

- RemNote 官方数据库 `remnote.db` 只能 **只读**；写入必须走 `queue -> WS bridge -> plugin SDK`。
- 插件执行器与 WS bridge 目前都围绕宿主机本地链路设计：插件默认连 `ws://localhost:<port>/ws`。
- 项目当前最稳定的 machine surface 是 `CLI --json`，而不是 HTTP API。

但在“宿主机运行 RemNote，容器内运行 agent”的真实使用形态下，直接让容器去碰宿主机上的 `remnote.db` / `store.sqlite` / `ws://localhost:6789/ws` 会带来三个问题：

1. **路径与挂载复杂**：容器需要感知宿主机的 RemNote 数据目录与状态文件，破坏本地开箱即用体验。
2. **职责混乱**：插件、active worker、UI context、store DB 的 authoritative state 实际都在宿主机，容器不应再成为第二控制面。
3. **排障成本高**：一旦容器直接跨边界访问 DB/WS，问题会混杂在路径、网络、锁、生命周期多个层面。

因此，本 spec 的裁决是：

- **宿主机**运行 authoritative `agent-remnote` runtime；
- **容器内 agent** 只通过一个稳定、标准、面向本机自用的 Host API 访问能力；
- 现有 `daemon/ws` 继续只负责插件协同，不直接承担对容器的 API surface；
- 同时补齐一套完整的 `api` / `stack` 命令面，让“启动、停止、状态、日志、ensure”都能一把梭。

## Scope

### In Scope

- 新增 **宿主机 authoritative deployment model**：RemNote Desktop / plugin / `agent-remnote daemon` / `store.sqlite` / Host API 全部运行在宿主机。
- 新增 **本机自用 Host API**：以 HTTP + JSON 为主，对容器内 agent 暴露稳定入口。
- 新增 `api` 命令组：
  - `api serve`
  - `api start`
  - `api stop`
  - `api status`
  - `api logs`
  - `api restart`
  - `api ensure`
- 新增 `stack` 命令组：
  - `stack ensure`
  - `stack stop`
  - `stack status`
- Host API 默认 **本机自用、无鉴权**；不引入公网/多租户/权限系统。
- Host API 响应 envelope 与现有 CLI `--json` 契约对齐（稳定 `ok/data` 与 `ok=false/error` 结构，错误码/英文 message/nextActions 一致）。
- 默认 HTTP 端口使用项目既有口径：`3000`（可通过 `PORT` 覆盖）。
- 现有业务 CLI 命令在需要时可切换为 **remote API mode**；该模式 MUST 同时支持参数 `--api-base-url` 与环境变量 `REMNOTE_API_BASE_URL`。
- 保持 WS bridge 作为插件私有 control plane；HTTP API 不直接暴露底层 WS 协议。
- 抽取共享 use case / service 层，供 CLI 与 HTTP API 共同调用；**不允许** Host API 通过 shelling out 到 `agent-remnote --json` 自己来实现主要功能。
- 同步补齐 spec 契约、命令文档、README 与 SSoT 更新点。

### Out of Scope

- 公网暴露、安全鉴权、CORS、多租户、RBAC。
- 把现有 `daemon/ws` 直接改造成“WS + HTTP + API lifecycle”混合大进程。
- 让容器直接读写宿主机的 `remnote.db` / `store.sqlite` / `ws.bridge.state.json`。
- 为旧部署模型保留长期兼容层；仓库仍遵循 forward-only evolution。
- SSE / Webhook / SDK package 等额外分发形态（如需可在后续 spec 单独定义）。

## 架构裁决

### 裁决 1：宿主机 authoritative，容器只做 API client

- **MUST**：RemNote Desktop、plugin、WS daemon、store DB、Host API 都运行在宿主机。
- **MUST NOT**：容器直接成为 queue/store/db/ws 的第二 authoritative runtime。
- **SHOULD**：容器内 agent 只依赖一个 Host API base URL，例如 `http://host.docker.internal:3000`。

### 裁决 2：`daemon` 与 `api` 分治

- `daemon` 保持现有职责：WS bridge、plugin 协同、queue dispatch、active worker 与 UI state。
- `api` 作为单独命令组与单独后台服务存在，对外提供 HTTP/JSON surface。
- `stack` 作为更高层的聚合命令，负责“一键确保/停止/查看整体状态”。

### 裁决 3：本机自用优先于安全复杂度

- 默认信任边界是“宿主机 + 本地容器 + 自己使用”。
- v1 **不做 token / auth / ACL**。
- 为减少容器访问摩擦，API 默认监听 **`0.0.0.0:3000`**；但仍提供 `--host` / `PORT` 覆盖。
- `api.state.json` 必须暴露推荐访问地址：
  - `localBaseUrl = http://127.0.0.1:<port>`
  - `containerBaseUrl = http://host.docker.internal:<port>`

### 裁决 4：API 是新的 machine surface，但不复制第二套语义

- HTTP API 与 CLI 必须复用同一份领域 use cases / error model。
- HTTP API 可以是“REST-ish / command-style JSON”，**不强求纯 REST**；优先满足 Agent 易调用、语义稳定、排障简单。
- 对外错误码、英文 message、`nextActions[]` 必须与 CLI / SSoT 一致。
- 现有业务命令（如 `search` / `plugin search` / `import markdown` / `queue wait`）在 remote API mode 下继续保留原命令名；`api` 命令组只负责 API 服务生命周期，不承担业务代理命名空间。
- remote API mode 的优先级裁决：显式参数 `--api-base-url` 高于环境变量 `REMNOTE_API_BASE_URL`，环境变量高于用户配置文件 `~/.agent-remnote/config.json` 中的 `apiBaseUrl`；未提供时走本地 direct mode。

## 用户场景与测试（必填）

### 用户故事 1：容器内 agent 可通过宿主机 API 读取 RemNote（P0）

作为在容器内运行的 agent，我希望不用挂载 RemNote DB 或状态文件，就能通过宿主机 API：

- 获取健康状态、active worker、UI context；
- 做 DB Pull 搜索；
- 做 plugin read-rpc 搜索；
- 查询 queue / txn 状态。

### 用户故事 2：容器内 agent 可通过宿主机 API 发起安全写入（P0）

作为在容器内运行的 agent，我希望通过宿主机 API 完成安全写入闭环：

- 发起 write / enqueue；
- 触发同步（如需要）；
- 等待 txn 终态；
- 拿到与 CLI 一致的结构化结果与错误。

### 用户故事 3：本机用户能一条命令拉起/停止整套运行时（P0）

作为本机用户，我希望：

- `stack ensure` 一次确保 `daemon + api` 都可用；
- `stack stop` 一次停止整套服务；
- `stack status` 一次查看整套状态。

### 用户故事 4：维护者仍能把 plugin control plane 与 API surface 分开排障（P1）

作为维护者，我希望：

- `daemon` 问题继续用 daemon 命令排障；
- `api` 问题继续用 api 命令排障；
- 不把 HTTP 问题、WS 问题、queue 问题混成一个进程/一套日志。

## 需求（必须）

### 功能需求（FR）

- **FR-001**：系统 MUST 支持“宿主机 authoritative + 容器 API client”部署模型；Host API 成为容器访问 RemNote 能力的唯一标准入口。
- **FR-002**：系统 MUST 新增 `api` 命令组，并至少支持 `serve/start/stop/status/logs/restart/ensure`。
- **FR-003**：`api serve` MUST 是前台长驻进程；`api start` MUST 启动后台服务；`api stop` MUST 停止后台服务。
- **FR-004**：系统 MUST 新增 `stack` 命令组，并至少支持 `ensure/stop/status`，用于聚合 `daemon + api` 的生命周期。
- **FR-005**：Host API MUST 默认监听 `0.0.0.0:3000`；端口 MUST 支持 `PORT` 覆盖；host MUST 支持显式参数/env 覆盖。
- **FR-006**：Host API MUST 至少提供以下 HTTP 入口：
  - `GET /v1/health`
  - `GET /v1/status`
  - `GET /v1/ui-context`
  - `GET /v1/selection`
  - `POST /v1/search/db`
  - `POST /v1/search/plugin`
  - `POST /v1/write/ops`
  - `POST /v1/write/markdown`
  - `POST /v1/queue/wait`
  - `GET /v1/queue/txns/:txnId`
  - `POST /v1/actions/trigger-sync`
- **FR-007**：HTTP API 返回体 MUST 复用 CLI `--json` envelope 语义；错误码、英文 `message`、`nextActions[]` 必须与 CLI 对齐。
- **FR-008**：HTTP API 的读写实现 MUST 复用共享 use case / service 层，避免通过进程内 shell 调用 CLI 二次转发。
- **FR-009**：API lifecycle 必须具备独立 pid/log/state 文件，以支撑 `api stop/status/logs/restart/ensure`。
- **FR-010**：`stack ensure` MUST 在缺失或不健康时自动拉起 `daemon` 与 `api`；若都健康则 no-op 并给出可诊断状态。
- **FR-011**：系统 MUST 保持现有 WS bridge / plugin 协议语义不变；HTTP API 不得绕过 queue / plugin 写入链路。
- **FR-012**：现有业务 CLI 命令 MUST 支持 remote API mode，并同时提供参数 `--api-base-url` 与环境变量 `REMNOTE_API_BASE_URL`。
- **FR-013**：当业务命令运行在 remote API mode 时，CLI MUST 调用宿主机 Host API，而不是直接访问本地 `remnote.db` / `store.sqlite` / WS bridge。
- **FR-014**：文档 MUST 同步更新 `README.md`、`README.zh-CN.md` 与对应 SSoT / runbook 入口。

### 非功能需求（NFR）

- **NFR-001**：本功能以“本机自用、可信本地环境”为前提；实现不得为了安全复杂度牺牲默认使用体验。
- **NFR-002**：从零开始的本机环境中，用户应能用一条命令（`stack ensure`）完成最小闭环。
- **NFR-003**：既有 CLI machine surface 不得回归；HTTP API 是新增 front door，不是替换 CLI。
- **NFR-004**：所有新命令与 API 错误输出必须保持英文用户可见文本；内部 spec 说明允许中文。
- **NFR-005**：forward-only：新增命令/配置/文件路径允许 breaking，但必须 fail-fast + 可诊断。

## 成功标准（必填）

- **SC-001**：用户在宿主机启动 `stack ensure` 后，容器内 agent 可用 `http://host.docker.internal:3000/v1/health` 成功访问。
- **SC-002**：容器内 agent 能通过 Host API 完成一次“搜索 -> 写入 -> queue wait”闭环，而无需挂载 `remnote.db` / `store.sqlite` / ws state file。
- **SC-003**：用户可以分别用 `daemon ...` 与 `api ...` 排障，也可以用 `stack status` 做整体状态判断。
- **SC-004**：HTTP API 与 CLI 在相同 use case 下返回同源的结构化错误码/结果字段，不产生第二套语义漂移。
