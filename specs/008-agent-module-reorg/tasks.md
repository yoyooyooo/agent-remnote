# Tasks: Merge core into agent-remnote（模块重组）

**Input**: Design documents from `specs/008-agent-module-reorg/`  
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/*`, `quickstart.md`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件且无依赖）
- **[Story]**: `[US1]` / `[US2]` / `[US3]`
- 每条任务描述必须包含明确文件路径

---

## Phase 1: Setup（基线与影响面盘点）

- [x] T001 建立“重组基线”检查清单（列出必须通过的现有契约测试与 smoke）到 `specs/008-agent-module-reorg/quickstart.md`
- [x] T002 盘点并记录所有 `packages/core` 的引用点（代码 + 文档）到 `specs/008-agent-module-reorg/research.md`
- [x] T003 盘点 `packages/agent-remnote/src/adapters/core.ts` 当前导出集合，并对齐到 `specs/008-agent-module-reorg/data-model.md`

---

## Phase 2: Foundational（模块骨架与边界门禁）

**⚠️ CRITICAL**: 本阶段完成前不开始删除 `packages/core`

- [x] T004 创建 internal 模块目录骨架与入口文件：`packages/agent-remnote/src/internal/{queue,ws-bridge,remdb-tools}/index.ts`
- [x] T005 在 `packages/agent-remnote/src/internal/` 增加统一门面（替代旧 `public.ts`）：`packages/agent-remnote/src/internal/public.ts`
- [x] T006 [P] 增加“禁止深路径 import”的最小门禁（契约测试或脚本检查）到 `packages/agent-remnote/tests/*`（例如禁止 `../core/src/` 与 `internal/**/dao.ts` 这类深引）
- [x] T007 明确并固化实施阶段的依赖方向约束（如需补充）到 `specs/008-agent-module-reorg/contracts/module-boundaries.md`

**Checkpoint**: internal 骨架存在且能被 `agent-remnote` 代码引用（仍可暂时指向旧实现）

---

## Phase 3: User Story 1 - CLI 用户/Agent 无感升级（功能不变） (Priority: P1) 🎯 MVP

**Goal**: 合并 `core` 并完成模块重组，同时保持所有对外行为/契约不变。

**Independent Test**: `packages/agent-remnote/tests/contract/*.contract.test.ts` 全部通过；`--json` 输出纯度与 exit code 语义不变。

### Implementation（无损搬迁 → 切换引用 → 删除 core）

- [x] T008 [US1] 迁移队列模块实现到 `packages/agent-remnote/src/internal/queue/**`（从 `packages/core/src/queue/**` 无损搬迁）
- [x] T009 [US1] 迁移只读 DB 工具到 `packages/agent-remnote/src/internal/remdb-tools/**`（从 `packages/core/src/tools/**` 无损搬迁）
- [x] T010 [US1] 迁移 WS bridge 到 `packages/agent-remnote/src/internal/ws-bridge/**`（从 `packages/core/src/ws/bridge.ts` 无损搬迁）
- [x] T011 [US1] 修复 internal 迁移后的相对 import、ESM 后缀与资源加载（含 `schema.sql` bundling fallback）在 `packages/agent-remnote/src/internal/**`
- [x] T012 [US1] 切换 `packages/agent-remnote/src/adapters/core.ts`：从直引 `packages/core/src/public.js` 改为导出 `packages/agent-remnote/src/internal/public.ts`
- [x] T013 [US1] 修复 `packages/agent-remnote/src/services/{Queue,RemDb}.ts` 等对 core 类型/函数的依赖，确保改为 internal 门面导入且行为不变
- [x] T014 [US1] 更新 `packages/agent-remnote/package.json` 依赖：补齐原 `packages/core/package.json` 中仅 core 使用的依赖（如 `date-fns`、`unified`、`remark-*` 等）
- [x] T015 [US1] 运行并修复 `packages/agent-remnote/tests/*`（保持既有契约测试全部通过）

### Remove `packages/core`

- [x] T016 [US1] 从根 `package.json` 的 workspaces 中移除 `packages/core`（文件：`package.json`、`turbo.json` 如需）
- [x] T017 [US1] 删除 `packages/core/`（确认无引用后再删），并修复仓库内残留引用（代码与 docs）
- [x] T018 [US1] 运行全量质量门禁（文件覆盖：`packages/agent-remnote/tests/*`，以及仓库默认 gates）

---

## Phase 4: User Story 2 - 维护者能快速定位能力与边界 (Priority: P2)

**Goal**: 让能力归属与依赖方向在代码结构与文档中清晰一致，降低未来演进成本。

**Independent Test**: `specs/008-agent-module-reorg/data-model.md` 与实际目录一致；并且“禁止深路径 import”门禁持续生效。

- [x] T019 [US2] 在 `packages/agent-remnote/src/internal/**/index.ts` 明确导出最小入口（避免泄露内部文件结构）
- [x] T020 [US2] 收敛路径/默认值工具的重复实现（遵守 homedir+join+normalize 与 `~` 展开）在 `packages/agent-remnote/src/lib/paths.ts` 与 `packages/agent-remnote/src/internal/**`
- [x] T021 [US2] 将 internal 中出现的 CLI 专属文案/提示（如 “Fallback to DB search: agent-remnote ...”）逐步迁移到 `packages/agent-remnote/src/services/` 或 `packages/agent-remnote/src/commands/`（保持对外文本不变）
- [x] T022 [US2] 更新 `specs/008-agent-module-reorg/data-model.md`：补齐最终落地后的文件映射与模块入口（确保可作为长期索引）

---

## Phase 5: User Story 3 - 面向未来的可拆分路线 (Priority: P3)

**Goal**: 交付一份清晰可执行的未来拆包路线图，并与重组后的模块边界一致。

**Independent Test**: 存在 docs 文档落点，且能回答“何时拆/拆哪些/怎么拆/如何验证与回滚”。

- [x] T023 [US3] 新增/更新未来拆包路线图文档到 `docs/architecture/future-packaging.md`（与 `specs/008-agent-module-reorg/contracts/future-packaging.md` 对齐）
- [x] T024 [US3] 更新 SSoT 文档中的实现锚点与目录描述（例如 `docs/ssot/agent-remnote/ws-bridge-protocol.md`、`docs/ssot/agent-remnote/README.md`）

---

## Phase N: Polish & Cross-Cutting Concerns

- [x] T025 [P] 更新仓库协作约定中的目录说明（移除 `packages/core` 相关描述）在 `AGENTS.md`
- [x] T026 [P] 更新根文档中对包结构的描述与示例（如引用了 `packages/core`）在 `README.md` 与 `README.zh-CN.md`
- [x] T027 跑 `specs/008-agent-module-reorg/quickstart.md` 的验收清单并补齐缺口（必要时补最小契约测试）

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → Phase 3（先无损搬迁再删 core）是硬依赖。
- US2/US3 可以与 US1 的后期并行，但不得破坏 US1 的“功能不变”门禁。

## Parallel Opportunities

- `T006`、`T025`、`T026` 可并行。
- internal 三块迁移（queue/ws-bridge/remdb-tools）在执行层面可并行，但建议按依赖顺序串行落地以降低集成风险（queue → ws-bridge → remdb-tools 或 remdb-tools 与 ws-bridge 并行）。
