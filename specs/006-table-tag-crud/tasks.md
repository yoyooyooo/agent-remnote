# Tasks: Table / Tag CRUD Alignment (006)

**Input**: `specs/006-table-tag-crud/` (spec/plan/research/data-model/contracts/quickstart)
**Tests**: Yes — CLI contract tests (Vitest)
**Organization**: Tasks are grouped by user story (US1/US2/US3)

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Wire new subcommands under `packages/agent-remnote/src/commands/write/index.ts`
- [x] T002 [P] Add table/tag/rem write command folder structure under `packages/agent-remnote/src/commands/write/`
- [x] T003 [P] Add shared option builders/utilities for new write commands in `packages/agent-remnote/src/commands/write/_shared.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T004 建立 Op Catalog（canonical snake_case）并生成 LLM-friendly 视图（替代 `listSupportedOps.ts` 的手写字段）；以插件 handler 为裁决点对齐 payload 字段：`packages/agent-remnote/src/kernel/op-catalog/**` + `packages/agent-remnote/src/internal/remdb-tools/listSupportedOps.ts`
- [x] T004a （跨 spec 复用）在 Op Catalog 中补齐最小元信息：`id_fields`（ID 语义字段）与保守 `WriteFootprint/ConflictKey` 推导入口，供 010/012 复用：`packages/agent-remnote/src/kernel/op-catalog/**`
- [x] T005 Align SSoT write semantics & payload field names in `docs/ssot/agent-remnote/tools-write.md`
- [x] T006 Define `values[]` parsing + validation helpers (array-only) in `packages/agent-remnote/src/lib/tableValues.ts`

---

## Phase 3: User Story 1 - Table 记录 CRUD + 读回 cells (Priority: P1) 🎯 MVP

**Goal**: 在 “Table=Tag” 视角下新增/修改/删除记录，并在 read_table_rem 中读回列定义与单元格值。

**Independent Test**: 仅实现 `write table record add/update/delete` + `read table` 即可：能创建记录、修改字段、删除并确认读不到。

- [x] T007 [US1] Implement `write table record add` in `packages/agent-remnote/src/commands/write/table/record/add.ts`
- [x] T008 [US1] Implement `write table record update` in `packages/agent-remnote/src/commands/write/table/record/update.ts`
- [x] T009 [US1] Implement `write table record delete` in `packages/agent-remnote/src/commands/write/table/record/delete.ts`
- [x] T010 [US1] Add `write table` command routing in `packages/agent-remnote/src/commands/write/table/index.ts`
- [x] T011 [US1] Extend `read_table_rem` to output `cells` for all property kinds in `packages/agent-remnote/src/internal/remdb-tools/readRemTable.ts`
- [x] T012 [US1] Update CLI `read table` output expectations in `packages/agent-remnote/src/commands/read/table.ts`
- [x] T013 [P] [US1] Add contract tests for table record commands in `packages/agent-remnote/tests/contract/write-table-record.contract.test.ts`

---

## Phase 4: User Story 2 - 单 Rem 的 Tag 增删 + Rem 删除 (Priority: P2)

**Goal**: 提供严格边界的 Tag add/remove 与 Rem delete 命令，避免误删。

**Independent Test**: `--dry-run --json` 生成的 op.type/payload 与插件 handler 对齐；参数互斥/必填校验正确。

- [x] T014 [US2] Implement `write tag add/remove` in `packages/agent-remnote/src/commands/write/tag/index.ts`
- [x] T015 [US2] Implement `write rem delete` in `packages/agent-remnote/src/commands/write/rem/delete.ts`
- [x] T016 [P] [US2] Add contract tests in `packages/agent-remnote/tests/contract/write-tag-rem.contract.test.ts`

---

## Phase 5: User Story 3 - Table 属性/选项管理 (Priority: P3)

**Goal**: 支持对 tableTag 的列定义与选项的新增/调整，并能被 read_table_rem 读到列/选项信息。

**Independent Test**: `write table property add/set-type` + `write table option add/remove` 的 dry-run op 对齐；read_table_rem 输出 properties/options 结构稳定。

- [x] T017 [US3] Implement `write table property add/set-type` in `packages/agent-remnote/src/commands/write/table/property/index.ts`
- [x] T018 [US3] Implement `write table option add/remove` in `packages/agent-remnote/src/commands/write/table/option/index.ts`
- [x] T019 [P] [US3] Add contract tests in `packages/agent-remnote/tests/contract/write-table-property-option.contract.test.ts`

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T020 Update CLI docs in `README.md`
- [x] T021 Update CLI docs in `README.zh-CN.md`
- [x] T022 Validate `specs/006-table-tag-crud/quickstart.md` against final CLI surface
- [x] T023 Update `$remnote` skill recipes for new table/tag/rem write commands (agent-facing shortest path + common pitfalls like parent/daily fallback): `$CODEX_HOME/skills/remnote/SKILL.md`

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 blocks all stories
- US1 is MVP (do first)
- US2/US3 can proceed after Phase 2
- Doc updates (Phase 6) after commands stabilize
