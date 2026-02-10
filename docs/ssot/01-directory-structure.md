# 01 · 目录结构与落点裁决

## 结论（TL;DR）

本仓库是 monorepo（workspaces 当前显式列举 `packages/agent-remnote` 与 `packages/plugin`），核心边界为：`agent-remnote`（CLI/daemon + 内置 internal 能力模块）/ `plugin`（RemNote 执行器）。

## 顶层目录

- `packages/`：可运行/可复用的核心模块（见下文分包说明）。
- `docs/`：文档（`docs/ssot/` 为裁决来源；`docs/guides/` 为操作手册；`docs/proposals/` 为草案；`docs/remnote/` 为 RemNote 概念与只读笔记）。
- `scripts/`：一次性脚本与本地辅助工具（不得成为运行时代码的隐式依赖）。
- `specs/`：特性计划与推进记录（非裁决来源）。

## packages 分包（边界与状态）

- `packages/agent-remnote/`：运维/调试 CLI（Effect + @effect/cli）；提供 bridge/ws/queue/read 等子命令。
- `packages/plugin/`：RemNote 插件（Executor，Vite 构建）；产出 `PluginZip.zip` 供 RemNote 安装。
  - 如未来新增 packages：必须同步更新根 `package.json` 的 workspaces 与本文件，避免“目录存在但不在构建/测试门禁里”或“误把临时目录加入 workspace”。

## 放置规则（避免漂移）

- 协议/Schema/边界的“裁决版”变更：优先更新 `docs/ssot/**`（尤其 `docs/ssot/agent-remnote/**`）；未定型方案放在 `docs/proposals/**`。
- 新增 CLI 子命令：放在 `packages/agent-remnote/src/commands/**`，并复用 `packages/agent-remnote/src/internal/**` 的能力实现。
- 新增写入能力（op.type）：先补齐队列/协议/工具语义文档，再落到 `packages/agent-remnote/src/internal/**`（与 `plugin` 执行器）实现。

## 代码锚点（Code Anchors）

- workspace 与脚本入口：`package.json`
- internal 能力门面：`packages/agent-remnote/src/internal/public.ts`
- Store DB（SQLite）：`packages/agent-remnote/src/internal/store/{db.ts,schema.sql,migrations/*}`
- 队列模块（DAO/Sanitize）：`packages/agent-remnote/src/internal/queue/{dao.ts,sanitize.ts}`
- 兼容导出（历史路径）：`packages/agent-remnote/src/adapters/core.ts`
- `agent-remnote` 入口：`packages/agent-remnote/src/main.ts`
- 插件入口与控制通道：`packages/plugin/src/widgets/index.tsx`
- 插件迁移交接：`handoff.md`
