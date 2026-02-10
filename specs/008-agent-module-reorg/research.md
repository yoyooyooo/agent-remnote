# Research: Merge core into agent-remnote（模块重组）

**Feature**: `008-agent-module-reorg`  
**Date**: 2026-01-24  
**Inputs**: `specs/008-agent-module-reorg/spec.md`, `.specify/memory/constitution.md`, current repository structure

## Decisions

### D1) 将 `packages/core` 合并到 `packages/agent-remnote`

**Decision**: 删除“软边界 core 包”，把其代码与能力迁入 `packages/agent-remnote/src/internal/**`。  
**Rationale**:
- 现状 `agent-remnote` 已直引 `core/src/*`，且存在 env 透传；这不是一个真正“硬分包”的 core。
- 目前无其它项目依赖 `@remnote/core`，保留独立包的收益低、心智与维护成本高。
- 合并后更容易做一次“全局最优”的目录与依赖方向重组，未来再抽包更自然（从 internal 迁出即可）。
**Alternatives**:
- A1：保留 `packages/core`，改造为硬 API（通过依赖 + exports 门禁）→ 现在没有外部 consumer，性价比低。
- A2：立即拆更多包（queue/ws/remdb-tools）→ 过早工程化，且仍可能在边界不清时形成更难改的“假硬包”。

### D2) `agent-remnote` 采用“模块化单体 CLI”的分层

**Decision**: 在 `packages/agent-remnote/src/` 内固定 3 层：
- `commands/**`：命令树（presentation），负责解析/编排/输出，不承载协议与存储细节。
- `services/**`：Effect runtime 的 IO 适配层（ports/adapters），负责配置、错误映射、进程/WS client 等。
- `internal/**`：kernel 能力模块（未来可抽包），负责 queue/ws-bridge/remdb-tools 等“非命令专属”能力。

**Rationale**:
- 对 CLI 来说，“公共 API”是命令契约而不是 TS exports；分层的核心价值是固定依赖方向与降低耦合。
- 未来抽包时，不需要“从 commands 里挖逻辑”，而是把 internal 模块整体搬迁到 `packages/*`。

### D3) kernel 模块划分（internal data-model）

**Decision**: internal 切成 3 个一级模块（与现有能力天然对齐）：
- `internal/queue`：队列 DB、schema、dao、sanitize。
- `internal/ws-bridge`：WS daemon/bridge、active worker 选举、state file、kick/dispatch/ack。
- `internal/remdb-tools`：只读 RemNote DB 工具（search/outline/inspect/todos/topic/daily 等）。

**Rationale**:
- 三块能力在 runtime 与依赖上高度内聚且边界天然：DB 写队列 / WS 协议与派发 / DB 只读查询。
- 可以分别独立测试、独立演进，也分别是未来最可能的“硬子包”候选。

### D4) 配置/环境变量策略：保持兼容，逐步显式化

**Decision**:
- **短期（本重组交付）**：保持现有 env 名称与默认行为不变（尤其 WS bridge 的 debug/state/tmux/kick 等），确保“功能不变”。
- **中期（在实现任务中做无损收敛）**：把 CLI 已有的 `services/Config.ts` 作为“配置权威入口”，internal 模块以显式参数为主、env 为兜底，逐步消灭跨模块的 `process.env = ...` 透传。

**Rationale**:
- env 行为属于用户可见行为的一部分；重组阶段不应引入隐性 breaking change。
- 但必须降低“隐式耦合”（例如通过 env 传递 queueDb），为未来抽包与测试隔离铺路。

### D5) 文档锚点与裁决：更新 SSoT，新增未来路线图文档

**Decision**:
- 任何引用 `packages/core/src/...` 的 SSoT 文档，需要在实现阶段同步更新到新的代码锚点（例如 WS bridge 实现路径）。
- 新增/更新一份面向未来的“拆包路线图”文档（落在 `docs/architecture/**` 或等价位置），并与 `specs/008.../data-model.md` 保持一致。

## Quality Gates（“功能不变”的证据）

**Minimum Pass**（必须通过）：
- `packages/agent-remnote/tests/*` 的 CLI 契约测试（覆盖 `--json` 输出纯度、help、invalid options、write sanitize、ws health 等）。
- 核心 smoke：至少覆盖 `agent-remnote --help`、`agent-remnote doctor`、`agent-remnote daemon status/health`（在可用环境下）。

**Default Gates**（constitution 推荐）：
- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm test`

## Risks & Mitigations

- **Bundling & asset loading**：队列 schema.sql 在 bundling 下可能无法通过 `new URL(..., import.meta.url)` 读取 → 保留/复用现有 fallback 策略，或在 agent-remnote 内提供等价机制。
- **ESM import 路径与 `.js` 后缀**：迁移时必须保持 NodeNext/ESM 的 import 习惯（编译产物后缀一致），避免运行时找不到模块。
- **路径工具重复实现**：合并时优先收敛 `expandHome/normalize` 与默认路径生成，避免未来漂移。
- **超大文件可维护性**：`ws-bridge` 体量较大，短期先无损搬迁，后续再按子域拆文件（协议 types / election / state file / dispatcher）。

## Inventory: `packages/core` 引用点（代码 + 文档）

> 本清单用于实施阶段的“影响面闭环”（迁移/改路径/更新锚点）。完成迁移后应确保仓库内不再存在对 `packages/core` 的引用。

### Code (runtime)

- `packages/agent-remnote/src/adapters/core.ts`（当前直引 `../../../core/src/public.js` 作为门面）
- `packages/core/package.json`（将被移除）

### Scripts (dev/integration)

- `scripts/run-tool.ts`（大量直引 `../packages/core/src/tools/*` + `../packages/core/src/ws/bridge.js`）
- `scripts/find-rem-by-name.ts`
- `scripts/simulate-today-note.ts`
- `scripts/outline-today-note.ts`
- `scripts/peek-rems-search-info.ts`
- `scripts/integration-test-connections.ts`
- `scripts/queue-*.ts`（例如 `scripts/queue-seed.ts`、`scripts/queue-stats.ts`、`scripts/queue-inspect.ts` 等直引 `../packages/core/src/queue/*`）
- `scripts/integration-test-read-rpc-isolation-003.ts`（动态 import `../packages/core/src/public.js`）
- `scripts/integration-test-sync-reliability-004.ts`（动态 import `../packages/core/src/public.js`）

### Workspace metadata

- `package.json`（workspaces currently includes `packages/core`）
- `bun.lock`（包含 `packages/core` 与 `@remnote/core@workspace:packages/core`）

### Docs / SSoT

- `AGENTS.md`（目录说明含 `packages/core/`）
- `docs/ssot/00-principles.md`（依赖方向与核心实现路径）
- `docs/ssot/01-directory-structure.md`（core 对外入口说明）
- `docs/ssot/03-architecture-guidance.md`（queue/ws-bridge 锚点）
- `docs/ssot/agent-remnote/ws-bridge-protocol.md`（bridge 实现锚点）
- `docs/ssot/agent-remnote/queue-schema.md`（queue 实现锚点与建议）
- `docs/ssot/agent-remnote/ui-context-and-persistence.md`（bridge 实现锚点）
- `docs/ssot/agent-remnote/performance-sqlite.md`（tool 实现锚点）
- `docs/remnote/README.md`、`docs/remnote/local-db-readonly.md`
- `docs/remnote/guides/selection-and-events.md`
- `docs/remnote/guides/search-and-query.md`

### Specs / Acceptance evidence

- `specs/003-ws-identity/*`（多处锚点指向 `packages/core/src/ws/bridge.ts`）
- `specs/004-sync-reliability/research.md`
- `specs/005-search-safety/*`
- `specs/006-table-tag-crud/*`
- `specs/acceptance/003-004-005.md`
