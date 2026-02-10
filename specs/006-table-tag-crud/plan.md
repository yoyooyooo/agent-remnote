# Implementation Plan: Table / Tag CRUD Alignment

**Branch**: `006-table-tag-crud` | **Date**: 2026-01-24 | **Spec**: `specs/006-table-tag-crud/spec.md`  
**Input**: Feature specification from `specs/006-table-tag-crud/spec.md`

## Summary

把“Table=Tag、Record=Rem”的读写能力做成可被 Agent 一次性正确使用的语义化接口，并与插件侧执行器 1:1 对齐：

- 写：新增/修改/删除 table 记录；单 Rem 的 tag add/remove；Rem delete。
- 读：增强 read table，输出列定义 + 行数据（含单元格值）。
- 规则：任何创建 Rem 的入口必须最终有 parent；未指定写入位置则兜底写入 `daily:today`，若当日 Daily Doc 不存在则报错并提示先打开。
- 输入：`values` 仅支持数组形态（避免 key 归一化破坏 ID）。
- 文档：以 `docs/ssot/agent-remnote/**` 为裁决点，消除“文档/工具 schema 与插件 handler 漂移”。
- Op Catalog：以 `specs/006-table-tag-crud/contracts/ops.md` 为 seed，落地到 `packages/agent-remnote/src/kernel/op-catalog/**`，供 010（ConflictKey/WriteFootprint）与 012（ID 字段白名单/plan 校验）复用，避免重复 hardcode。

## Technical Context

- **Language/Runtime**: Node.js 20+，TypeScript ESM
- **Project Type**: Bun workspaces（monorepo）
- **Primary Packages**
  - `packages/agent-remnote/src/internal`: RemNote DB 只读工具 + queue SQLite
  - `packages/agent-remnote/src/runtime/ws-bridge`: WS bridge runtime（009+；legacy bridge 仍在 `src/internal/ws-bridge`）
  - `packages/agent-remnote`: CLI（Effect + @effect/cli），对外入口
  - `packages/plugin`: RemNote 插件执行器（消费队列 op 并调用 RemNote Plugin SDK）
- **Primary Dependencies**: `effect`, `@effect/cli`, `better-sqlite3`, `ws`, `zod`
- **Storage**
  - RNDB（只读）：RemNote 官方 SQLite `remnote.db`
  - QDB（写入队列）：`~/.agent-remnote/queue.sqlite`（可用 env 覆盖）
- **Target Platform**
  - 后端/CLI：Node.js
  - 执行器：RemNote Desktop（插件运行时）
- **Testing**: Vitest（CLI contract tests 为主）
- **Performance Goals**
  - read table：默认分页（limit/offset）+ 结构稳定；避免全表扫描与超大 JSON 输出。
  - 写入：保持“入队即返回”，不阻塞等待插件执行完成。
- **Constraints**
  - 用户可见输出（CLI/MCP schema/错误信息/日志）必须英文。
  - 禁止直接写入 `remnote.db`；所有写入必须走队列 + 插件执行链路。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Answer the following BEFORE starting research, and re-check after Phase 1:
  - How does this feature map to the
    `Intent → Flow/Logix → Code → Runtime` chain?
  - Which `docs/specs/*` specs does it depend on or modify, and are they
    updated first (docs-first & SSoT)?
  - Does it introduce or change any Effect/Logix contracts? If yes, which
    `.codex/skills/project-guide/references/runtime-logix/*` docs capture the new contract?
  - IR & anchors: does it change the unified minimal IR or the Platform-Grade
    subset/anchors; are parser/codegen + docs updated together (no drift)?
  - Deterministic identity: are instance/txn/op IDs stable and reproducible
    (no random/time defaults); is the identity model documented?
  - Transaction boundary: is any IO/async work occurring inside a transaction
    window; are write-escape hatches (writable refs) prevented and diagnosed?
  - Internal contracts & trial runs: does this feature introduce/modify internal
    hooks or implicit collaboration protocols; are they encapsulated as explicit
    injectable Runtime Services (no magic fields / parameter explosion), mockable
    per instance/session, and able to export evidence/IR without relying on
    process-global singletons?
  - Performance budget: which hot paths are touched, what metrics/baselines
    exist, and how will regressions be prevented?
  - Diagnosability & explainability: what diagnostic events/Devtools surfaces
    are added or changed, and what is the cost when diagnostics are enabled?
  - User-facing performance mental model: if this changes runtime performance
    boundaries or an automatic policy, are the (≤5) keywords, coarse cost model,
    and “optimization ladder” documented and aligned across docs/benchmarks/diagnostics?
  - Breaking changes: does this change any public API/behavior/event protocol;
    where is the migration note documented (no compatibility layer)?
  - What quality gates (typecheck / lint / test) will be run before merge,
    and what counts as “pass” for this feature?

### Mapping to `agent-remnote Constitution`

- 禁止直接修改 RemNote 官方数据库：本 feature 仅增强“只读查询 + 入队写入”，写入仍由插件 SDK 执行。
- Forward-only evolution：允许对现有 op payload schema/命令形态做 breaking change；需同步更新 SSoT 与 quickstart。
- SSoT 优先：以 `docs/ssot/agent-remnote/tools-write.md`、`queue-schema.md` 为裁决点；实现与文档必须同步。
- 预算与超时兜底：read table 等 DB 查询需要预算化（limit/offset）并避免不可控扫描。
- 唯一消费与可诊断身份：本 feature 不改变 active worker 模型；输出需保留 txn/op 可追踪信息。
- 跨平台路径规范：涉及路径解析处遵守 `homedir()` + `path.join/normalize` 与 `~` 展开规则。
- 用户可见输出语言：新增命令/错误信息需全英文（spec 文档可中文）。
- 可验证性：新增 CLI 命令需配套最小契约测试；读表增强需有可复现的离线验证策略（基于 DB 备份）。
- 非破坏性默认：删除类命令保持显式（table record delete / rem delete），避免隐式删除。

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
```text
packages/agent-remnote/
  src/internal/remdb-tools/   # read tools（含 read_table_rem）
  src/internal/queue/         # queue db + dao
  src/runtime/ws-bridge/      # WS bridge runtime（009+）
  src/internal/ws-bridge/     # legacy bridge（如仍在用）
  src/commands/              # CLI 命令入口（将新增 tag/table/rem 的语义化写命令）
  tests/                     # CLI contract tests

packages/plugin/
  src/bridge/ops/            # 插件执行器（本 feature 以对齐为主，尽量不改语义）

docs/ssot/agent-remnote/     # SSoT（tools-write 等）
```

**Structure Decision**: 本 feature 的主要实现落点在 `packages/agent-remnote`（语义化命令与参数解析 + internal 能力实现）；插件侧以现有 handler 为裁决点进行对齐。

## Design Decisions（面向实施的裁决）

### 命令语义与边界

详见 `specs/006-table-tag-crud/contracts/cli.md`，关键裁决：

- `write tag add/remove`：只做“单 Rem 的 tag 增删”；tag remove 不删除 Rem。
- `write rem delete`：直接删除 Rem。
- `write table record delete`：Table 视角删除记录 = 删除 Rem（建议执行前校验 row 是否属于该 tableTag，避免误删）。

### 创建 Rem 的 parent 规则

- 所有创建类写入必须最终得到 parent。
- 若用户未指定写入位置（无 parent/ref/UI page），兜底写入 `daily:today`。
- 若当日 Daily Doc 不存在，直接报错并提示用户先在 RemNote 打开今日 Daily Notes（不再引入二级兜底）。

### `values` 形状与解析规则

- 仅支持：`values: [{ propertyName?: string; propertyId?: string; value: any }]`
- `propertyId` 优先；仅 `propertyName` 时，在同一 `tableTag` 作用域内解析；歧义/缺失时报错并提示改用 `propertyId`。
- select/multi_select：允许用 optionName 表达，并在必要时允许直接用 optionId（由 `value` 的类型/形状决定）。

### read table 输出

- 输出必须稳定且可分页：`limit/offset/hasMore/nextOffset`。
- 行数据必须包含：row id、标题（纯文本）、以及 cells（按 propertyId 编排）。
- 必要时提供“includeOptions/includeCells”等开关，避免默认输出过大。

## Testing Strategy（最小）

- CLI contract tests（Vitest）覆盖新增命令的参数校验与 `--dry-run/--json` 输出 shape。
- read table：对固定 DB 备份跑离线验证（分页稳定、cells 输出结构）。
- 不做破坏性真实写入测试；写入链路的端到端验证留在 quickstart（人工/集成环境执行）。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
