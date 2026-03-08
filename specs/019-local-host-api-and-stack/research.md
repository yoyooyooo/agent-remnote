# Research: 019-local-host-api-and-stack

Date: 2026-03-08
Spec: `specs/019-local-host-api-and-stack/spec.md`

## 备选方案对比

### 方案 A：宿主机 authoritative + 独立 Host API（采纳）

**结构**

- 宿主机：RemNote Desktop + plugin + `agent-remnote daemon` + `agent-remnote api`
- 容器：agent client

**优点**

- 最贴近事实源：plugin、UI context、active worker、`remnote.db`、`store.sqlite` 都在宿主机。
- 容器只面对标准 API，不需要挂载 host 文件路径。
- `daemon` 与 `api` 职责清晰，排障路径稳定。
- 与现有架构最一致：继续保留 queue → WS → plugin 的写入链路。

**缺点**

- 需要新增一层 Host API 与 lifecycle 命令面。

**结论**

- 这是复杂度最低、边界最清晰、与现状最相容的方案。

### 方案 B：容器内 authoritative runtime，宿主机插件连容器 WS（拒绝）

**结构**

- 容器：`daemon` / `store.sqlite` / API
- 宿主机：RemNote Desktop + plugin

**问题**

- 插件默认连宿主机 `localhost`；需要改 host、端口、网络暴露与排障口径。
- 宿主机 UI state 与容器 runtime 跨边界耦合，故障面更大。
- 仍然无法消除宿主机对本地 RemNote DB/插件的依赖，只是把 control plane 搬远了一层。

**结论**

- 复杂度显著增加，但收益有限，不采纳。

### 方案 C：容器直接挂载宿主机 DB / state / store（拒绝）

**结构**

- 容器通过 bind mount 直接读取 `remnote.db`、`store.sqlite`、`ws.bridge.state.json`

**问题**

- 路径配置、锁、权限、挂载一致性复杂。
- 容器直接感知宿主机内部状态文件，边界极差。
- 违背“宿主机 authoritative，容器只用标准入口”的目标。

**结论**

- 不作为正式推荐形态。

## 关键设计裁决

1. 新增 **独立 `api` 命令组**，而不是给现有 `daemon` 混加 HTTP 参数后继续膨胀。
2. 为降低本机/容器使用成本，Host API 默认 **无鉴权**、**端口 3000**、**绑定 0.0.0.0**。
3. `api serve` 是前台长驻；`api start/stop/status/logs/restart/ensure` 是日常运维命令。
4. `stack ensure/stop/status` 作为更高层聚合入口，服务本机“一把梭”。
5. HTTP API 与 CLI 共享同一 use case / error model，避免并行真理源。

