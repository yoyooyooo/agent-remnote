当前仓库仍处在积极演进阶段，可以不计成本地重构与试验，不需要考虑向历史版本兼容。
任何一个地方都可以为了追求完美而推翻：本仓库采用「向前兼容（forward-only evolution）」策略，拒绝向后兼容。
当一个新的规划和已有实现产生交集甚至冲突时，需要寻求新的完美点，而不是坚持向后兼容。

# context

- remnote plugin: https://plugins.remnote.com/
- 本机针对官方插件文档的提炼版（若存在，可优先查看）：`~/llms.txt/docs/remnote`（Windows：`%USERPROFILE%\\llms.txt\\docs\\remnote`）

# agent-remnote（仓库协作约定）

> 面向人类与自动化代理的“最短可执行”工作协议。最后更新：2026-01-23

## 项目定位（先读这个）

- 目标：把 RemNote 变成可编程知识库：**读**本地 RemNote SQLite，**写**通过“操作队列 + WebSocket + RemNote 插件（官方 SDK）”安全落库。
- 红线：**禁止直接修改 RemNote 官方数据库**（否则可能破坏索引/同步/升级流程）。所有写入必须走队列/插件执行器链路。

## 目录与边界

- `packages/plugin/`：RemNote 插件（Executor），通过 WS 消费队列操作并调用官方插件 SDK 执行写入。
- `packages/agent-remnote/`：运维/调试 CLI（Effect + @effect/cli），包含 bridge/ws/queue/read 等子命令，并内置 internal 能力模块（用于未来可抽包演进）：
  - `packages/agent-remnote/src/internal/store/**`：Store DB（schema/migrations/open；单一持久化存储入口）
  - `packages/agent-remnote/src/internal/queue/**`：队列 SQLite（schema/dao/sanitize）
  - `packages/agent-remnote/src/internal/ws-bridge/**`：WS bridge（daemon）
  - `packages/agent-remnote/src/internal/remdb-tools/**`：RemNote 本地 DB 只读工具（search/outline/inspect 等）
- `scripts/`：本地脚本（WS 探活/确保启动/端到端模拟等）。
- `docs/`：协议与设计文档（队列 schema、WS 协议、工具语义等）。
- `specs/`：特性计划与推进记录（若有）。

## 默认端口与路径（常见坑）

- WS 默认地址：`ws://localhost:6789/ws`
- HTTP/SSE 默认端口：`3000`（可用 `PORT` 覆盖）
- Store DB：`~/.agent-remnote/store.sqlite`（可用 `REMNOTE_STORE_DB`/`STORE_DB` 覆盖；legacy：`REMNOTE_QUEUE_DB`/`QUEUE_DB`）
- WS 调试日志：`~/.agent-remnote/ws-debug.log`（见 `npm run dev:ws:debug:file`）
- daemon 文件：`~/.agent-remnote/ws.pid` / `~/.agent-remnote/ws.log` / `~/.agent-remnote/ws.state.json`（supervisor state）/ `~/.agent-remnote/ws.bridge.state.json`（bridge snapshot；可用 `REMNOTE_WS_STATE_FILE`/`WS_STATE_FILE` 覆盖）

## 常用命令（仓库根目录）

- CLI：`npm run dev`（直接运行 `agent-remnote`）
- WS bridge：`npm run dev:ws`
- WS 调试：`npm run dev:ws:debug` / `npm run dev:ws:debug:file`
- WS：`npm run ws:health` / `npm run ws:ensure`
- 插件打包：`cd packages/plugin && npm run build`（生成 `PluginZip.zip`）
- CLI 测试：`npm test`

## 格式化约定（oxfmt）

- 缩进：2 空格（`useTabs=false`，`tabWidth=2`）
- 行宽：`printWidth=120`
- 引号：单引号（`singleQuote=true`，`jsxSingleQuote=true`）
- 末尾逗号：开启（`trailingComma=all`）

## 工作方式（对人/代理都适用）

- 输出与沟通：默认中文；结论优先、步骤最少、变更可交接。
- 对外文本语言：所有“用户可见”的命令/工具输出统一英文（CLI 输出、MCP tool schema 的描述/提示、错误信息、运行日志等）。
- 代码注释语言：默认使用英文注释（除非必须保留原文引用/示例）。
- 允许保留中文：仅限用于解析/匹配用户内容的词表/正则/输入兼容分支；不得作为固定的对外响应文本输出。
- 文档优先：任何实现/语义/协议相关问题，默认先查 `docs/ssot/agent-remnote/**`（SSoT 为最高裁决点）；若实现与 SSoT 不一致，优先修实现或同步修文档，禁止长期漂移。
- 变更策略：只做与目标直接相关的最小改动；协议/Schema/工具语义的裁决版必须同步更新 `docs/ssot/agent-remnote/**`（未定型方案放 `docs/proposals/**`）。
- 命令文档同步：任何 `packages/agent-remnote` CLI（命令名/子命令/参数/默认值/示例）变更，必须同步更新 `README.md` 与 `README.zh-CN.md`（如 `README.local.md` 引用了相关命令，也需同步）。
- 验证要求：每次改动都要能本地验证（改 WS/队列→跑一次探活/模拟；改 CLI→跑对应 tests）。
- 跨平台路径规范：所有本地文件路径必须用 `node:os` 的 `homedir()` + `node:path` 的 `join/normalize` 生成；禁止手写 `${home}/...`；对用户输入路径必须支持 `~`、`~/`、`~\\` 展开并在解析后立即 `normalize`。
- 命令安全：长驻进程要确保可自动结束；探活/一次性检查优先用 `timeout 30s <cmd>`；需要后台再用 `nohup ... &` 并记录端口/日志路径。
- 禁止破坏性操作：除非用户明确要求，否则不要执行会丢数据或难回滚的命令（例如清空数据库、`rm -rf`、危险的 git 重置/清理）。

## 技术栈与约束

- TypeScript ESM（`"type":"module"`）：导入路径与产物保持一致（TS 输出侧多为 `.js` 后缀）。
- `effect`/`@effect/cli`：用于 `packages/agent-remnote` 的命令组织与错误处理。
- `better-sqlite3`：队列与本地 DB 读取；队列 schema 参见 `docs/ssot/agent-remnote/queue-schema.md`，演进采用 forward-only：允许 breaking change，但必须 fail-fast + 诊断（避免长期兼容层）。
- `ws`：WS bridge；消息/调试参见 `docs/ssot/agent-remnote/ws-bridge-protocol.md` 与 `docs/guides/ws-debug-and-testing.md`。

## 文档入口（先看这些）

- `docs/ssot/agent-remnote/README.md`
- `docs/ssot/agent-remnote/ws-bridge-protocol.md`
- `docs/ssot/agent-remnote/queue-schema.md`
- `docs/ssot/agent-remnote/ui-context-and-persistence.md`
- `docs/ssot/agent-remnote/tools-write.md`
- `docs/proposals/agent-remnote/read-tools-plan.md`

## Active Technologies
- TypeScript（ESM）+ Node.js 20+ + `effect` / `@effect/cli` / `ws` / `better-sqlite3` / `zod` (003-ws-identity)
- Store DB（`~/.agent-remnote/store.sqlite`）+ WS state file（`~/.agent-remnote/ws.bridge.state.json`） (003-ws-identity)
- TypeScript（ESM）+ Node.js 20+ + `effect` / `@effect/cli` / `@effect/platform-node` / `ws` / `better-sqlite3` / `zod` / `unified` + `remark-*` (008-agent-module-reorg)
- Node.js 20+，TypeScript ESM + `effect` / `@effect/cli` / `ws` / `better-sqlite3` / `zod` (012-batch-write-plan)
- store SQLite（默认 `~/.agent-remnote/store.sqlite`，可 env 覆盖） (012-batch-write-plan)
- TypeScript (ESM) + Node.js 20+ + `effect` / `@effect/cli` / `ws` / `better-sqlite3` (014-tmux-statusline-cleanup)
- local state files under `~/.agent-remnote/*` + store sqlite `~/.agent-remnote/store.sqlite` (014-tmux-statusline-cleanup)

## Recent Changes
- 003-ws-identity: Added TypeScript（ESM）+ Node.js 20+ + `effect` / `@effect/cli` / `ws` / `better-sqlite3` / `zod`
