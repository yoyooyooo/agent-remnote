# 03 · 架构边界与依赖方向

## 结论（TL;DR）

本系统的核心是把 RemNote 变成“可编程知识库”：

- **读**：从本地 `remnote.db` 只读检索/解析（用于查询、汇总、定位）。
- **写**：通过“Store DB（SQLite）+ WS bridge + RemNote 插件（官方 SDK）”安全落库（禁止直接写官方 DB）。

## 边界与职责

### 1) `agent-remnote/src/internal`（能力模块）

- Store：SQLite Store DB 的打开、迁移、schema（单一持久化存储入口）。
- 队列：SQLite 队列的打开、入队、统计、Schema（写入的“事实记录”与可重试基座）。
- WS bridge：提供插件控制通道/工作通道，派发 op 并接收回执。
- 读取工具：对 RemNote 本地 DB 做只读查询与结构化输出。

### 2) `agent-remnote`（CLI/daemon）

- 面向运维/调试：启动/探活 WS、入队写入、读取查询、排障与状态查看。
- 负责“把能力接线成命令”，能力实现落点在 `packages/agent-remnote/src/internal/**`。

### 3) `plugin`（RemNote 执行器）

- 运行在 RemNote 客户端内，通过 `@remnote/plugin-sdk` 执行写入。
- 通过 WS 与 bridge 通信：注册 consumer、接收 `StartSync`、拉取 op、执行并回执结果。

## 两条关键链路

### 写入链路（MUST）

1. 生产者（CLI/服务端）将写入意图编码为 op 入队（Store DB 的 queue tables）。
2. WS bridge 通知/派发 op 给 RemNote 插件。
3. 插件用官方 SDK 执行写入，由 RemNote 宿主负责索引/同步等内部流程。
4. 插件回执执行结果；队列记录结果以便追踪与重试。

### 读取链路（只读）

1. 读取工具定位 Rem（优先利用搜索相关表），必要时深入读取 `quanta.doc` 原始 JSON。
2. 输出结构化 JSON/Markdown，供上层（LLM/脚本）进一步处理。

## 默认地址与路径（约定）

- WS 默认地址：`ws://localhost:6789/ws`
- Store DB：`~/.agent-remnote/store.sqlite`（可用 `REMNOTE_STORE_DB`/`STORE_DB` 覆盖；legacy：`REMNOTE_QUEUE_DB`/`QUEUE_DB`）
- WS 调试日志：`~/.agent-remnote/ws-debug.log`（见 `npm run dev:ws:debug:file`）

## 契约与细节（权威文档）

- 队列 schema：`docs/ssot/agent-remnote/queue-schema.md`
- WS bridge 协议与插件集成：`docs/ssot/agent-remnote/ws-bridge-protocol.md`
- UI 上下文与持久化：`docs/ssot/agent-remnote/ui-context-and-persistence.md`
- 写入工具语义：`docs/ssot/agent-remnote/tools-write.md`
- 读取工具规划（草案）：`docs/proposals/agent-remnote/read-tools-plan.md`
- WS 调试与端到端测试：`docs/guides/ws-debug-and-testing.md`

## 代码锚点（Code Anchors）

- Store DB：`packages/agent-remnote/src/internal/store/schema.sql`、`packages/agent-remnote/src/internal/store/db.ts`
- 队列：`packages/agent-remnote/src/internal/queue/dao.ts`
- WS bridge：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`（WS adapter：`packages/agent-remnote/src/services/WsBridgeServer.ts`）
- CLI（入队/WS）：`packages/agent-remnote/src/commands/queue/*`、`packages/agent-remnote/src/commands/ws/*`
- 插件控制通道与同步：`packages/plugin/src/widgets/index.tsx`

## 验证方式（Evidence）

- 一次性质量门禁：`npm run check`
- WS 探活：`npm run ws:health`
