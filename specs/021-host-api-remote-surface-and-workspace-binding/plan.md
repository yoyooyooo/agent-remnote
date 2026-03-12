# Implementation Plan: 021-host-api-remote-surface-and-workspace-binding

Date: 2026-03-12  
Spec: `specs/021-host-api-remote-surface-and-workspace-binding/spec.md`

本 spec 采用 **一次性边界收口** 的实施方式，不做“先补少量 if/else、后续再系统重构”的临时路线。实现必须直接落到最终目标：**统一远程 client 语义 + Store DB 持久化 workspace binding + capability-aware 状态面 + `apiBasePath` 全链路贯通**。

## Workstream A：通用远程 surface 收口

目标：让 container caller、本机其他进程、远程 caller 在能力层完全等价，只认 `apiBaseUrl`。

交付：

- `apiBasePath` 从配置层打通到 runtime / client / state / status
- Host API client 不再硬编码 `/v1`
- `api.state.json` 与状态命令不再围绕 container-only 语义组织

## Workstream B：Store DB 持久化 workspace binding

目标：把“当前 KB -> dbPath”的长期事实源沉淀到 Store DB，而不是继续依赖目录扫描猜测。

交付：

- Store migration：新增 workspace binding 相关表
- `workspaceId -> dbPath` 绑定记录
- `currentWorkspaceId` 指针
- 可追溯的 binding 来源与验证时间

## Workstream C：确定性 workspace / DB 解析器

目标：建立统一的解析优先级与 fail-fast 诊断，替代散落在 use case / command 中的临时推断逻辑。

交付：

- 显式 workspace / deep link workspace 优先
- 已持久化 binding 优先于 live `kbId`
- live `uiContext.kbId` 触发首次自动绑定
- 目录扫描仅负责候选枚举与“唯一候选自动采用”
- 多候选无强信号时返回 `WORKSPACE_UNRESOLVED`

## Workstream D：capability-aware 状态与错误模型

目标：让远程调用方先看状态就能知道能做什么、不能做什么。

交付：

- `db_read_ready`
- `plugin_rpc_ready`
- `write_ready`
- `ui_session_ready`
- workspace 解析状态、当前 binding、候选 workspace、unresolved 诊断

## Workstream D1：端点分层与调用开销控制

目标：避免把 workspace resolver 做成所有端点的统一前置逻辑。

交付：

- `no_binding` / `binding_snapshot_only` / `db_resolver_required` 端点矩阵
- status 类端点只读 binding snapshot
- 只有 DB 相关端点才真正解析 `workspaceId + dbPath`

## Workstream E：远程命令矩阵、测试与文档

目标：把 remote-capable 命令矩阵、错误边界、SSoT、README、contract tests 一次对齐。

交付：

- remote-capable / host-only 命令矩阵固化
- Host API contract tests
- workspace binding / base path / unresolved 测试
- SSoT / README / runbook 更新

## 关键实现裁决

### 1. Workspace binding 进入 Store DB，而不是新增独立 JSON 状态文件

原因：

- 仓库已经把 Store DB 定义为单一持久化存储入口；
- binding 是长期事实，不是短期 runtime snapshot；
- 后续 status / diagnostics / remote selection 都需要稳定读取该状态。

建议落点：

- 新增 Store migration `0006-*`
- 新增 `workspace_*` 命名空间表
- 通过 service 封装访问，不在命令层直接写 SQL

### 2. `api.state.json` 保留 runtime snapshot 角色

`api.state.json` 只负责 API 进程的运行时状态与推荐访问地址，不承担 workspace binding 的长期持久化。

### 3. 解析器统一，调用点收敛

所有依赖 DB 选择的 Host API use case 与 remote-capable CLI 命令，都必须改为通过统一 resolver 获取 workspace / dbPath，避免命令各自读取 `uiContext.kbId` 或各自扫目录。

### 4. 多候选时拒绝长期猜测

“最近修改时间最新”只能作为候选排序的辅助，不能成为长期默认 workspace 的来源。

## 预计改动面

- Store migration / Store schema
- Host API runtime
- Host API client
- API / stack status 输出
- DB read use cases
- 相关 contract tests 与 SSoT 文档
