# 00 · 原则与红线

## 结论（TL;DR）

- **读**：允许只读访问 RemNote 本地 SQLite（`remnote.db`）。
- **写**：所有写入必须走「操作队列 SQLite → WebSocket → RemNote 插件（官方 SDK 执行）」链路。
- **演进**：本仓库采用 forward-only evolution；允许重构与推翻，但禁止并行真相源与“规则藏在隐式约定里”。

## 不变量（MUST）

- MUST 禁止直接修改 RemNote 官方数据库（`remnote.db`）。
- MUST 所有写入以“操作（op）”形式入队（SQLite 队列），并具备可重试/可观测的结果记录。
- MUST 插件端仅通过 `@remnote/plugin-sdk` 调用宿主 API 执行写入（由宿主负责索引/同步/触发器）。
- MUST 当对外语义/协议/边界发生变化时，同步更新 `docs/ssot/**`（与源码双向对齐）。

## 约束（SHOULD）

- SHOULD 让“协议/Schema/工具语义”有唯一的裁决点，避免在多个文档重复描述同一规则。
- SHOULD 保持依赖方向单向：`packages/agent-remnote/src/commands/**` + `packages/agent-remnote/src/services/**` → `packages/agent-remnote/src/internal/**`；运行时代码不应依赖 `scripts/**`/`docs/**`/`specs/**`。

## 代码锚点（Code Anchors）

- 队列：`packages/agent-remnote/src/internal/queue/*`
- WS bridge：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`（WS adapter：`packages/agent-remnote/src/services/WsBridgeServer.ts`）
- CLI/daemon：`packages/agent-remnote/src/main.ts`、`packages/agent-remnote/src/commands/**`
- 插件执行器：`packages/plugin/src/widgets/index.tsx`

## 验证方式（Evidence）

- 一次性质量门禁：`npm run check`
- WS 探活：`npm run ws:health`
