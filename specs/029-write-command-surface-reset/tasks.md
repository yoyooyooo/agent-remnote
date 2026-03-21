# Tasks: 029-write-command-surface-reset

**Input**: Design documents from `/specs/029-write-command-surface-reset/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/cli.md`, `quickstart.md`, `command-surface.md`

**Tests**: Included. This feature is a breaking public CLI contract reset.

## Phase 1: Setup

- [x] T001 Create write-surface contract scaffolding in `packages/agent-remnote/tests/contract/write-command-surface.contract.test.ts`
- [x] T002 [P] Extend removed-surface coverage in `packages/agent-remnote/tests/contract/removed-write-surface.contract.test.ts`
- [x] T003 [P] Extend help coverage in `packages/agent-remnote/tests/contract/help.contract.test.ts`
- [x] T004 [P] Create placement-spec and portal-strategy parser coverage in `packages/agent-remnote/tests/contract/write-command-surface.contract.test.ts`

## Phase 2: Foundational Parsing

- [x] T010 Add shared ref-value parser in `packages/agent-remnote/src/commands/write/_refValue.ts`
- [x] T011 [P] Add shared placement-spec parser for `--at` in `packages/agent-remnote/src/commands/write/_placementSpec.ts`
- [x] T012 [P] Add shared portal-strategy parser for `--portal in-place | at:<placement-spec>` in `packages/agent-remnote/src/commands/write/_portalStrategy.ts`
- [x] T013 [P] Add shared single-subject option helper in `packages/agent-remnote/src/commands/write/_subjectOptions.ts`
- [x] T014 Wire parser diagnostics, title-policy validation, and same-parent-contiguous checks into `packages/agent-remnote/src/commands/write/_shared.ts`

## Phase 3: Core Command Family Reset

- [x] T020 Update `rem create` contract expectations in `packages/agent-remnote/tests/contract/rem-create-promotion.contract.test.ts`
- [x] T021 [P] Update `rem create` selection-source expectations in `packages/agent-remnote/tests/contract/rem-create-selection.contract.test.ts`
- [x] T022 [P] Update `rem create` explicit-source expectations in `packages/agent-remnote/tests/contract/rem-create-targets.contract.test.ts`
- [x] T023 [P] Update `rem move` contract expectations in `packages/agent-remnote/tests/contract/rem-move-promotion.contract.test.ts`
- [x] T024 [P] Update `portal create` contract expectations in `packages/agent-remnote/tests/contract/write-portal-create.contract.test.ts`
- [x] T025 Rewrite `packages/agent-remnote/src/commands/write/rem/create.ts` to use `--from/--from-selection`, `--at`, and `--portal`
- [x] T026 Rewrite `packages/agent-remnote/src/commands/write/rem/move.ts` to use `--subject`, `--at`, and `--portal`
- [x] T027 Rewrite `packages/agent-remnote/src/commands/write/portal/create.ts` to use `--to` and `--at`
- [x] T028 Adapt `packages/agent-remnote/src/commands/write/rem/_promotion.ts` to the new command axes without changing canonical planner semantics

## Phase 4: Single-Subject Write Sweep

- [x] T030 Update `packages/agent-remnote/src/commands/write/rem/text.ts` to use `--subject`
- [x] T031 [P] Update `packages/agent-remnote/src/commands/write/rem/delete.ts` to use `--subject`
- [x] T032 [P] Update `packages/agent-remnote/src/commands/write/rem/children/append.ts` to use `--subject`
- [x] T033 [P] Update `packages/agent-remnote/src/commands/write/rem/children/prepend.ts` to use `--subject`
- [x] T034 [P] Update `packages/agent-remnote/src/commands/write/rem/children/clear.ts` to use `--subject`
- [x] T035 [P] Update `packages/agent-remnote/src/commands/write/rem/children/replace.ts` to use `--subject`
- [x] T036 [P] Update `packages/agent-remnote/src/commands/write/rem/replace.ts` to use `--subject` for explicit Rem targeting
- [x] T037 [P] Update direct Rem tag write surface in `packages/agent-remnote/src/commands/write/tag/index.ts`

## Phase 5: Legacy Surface Removal

- [x] T040 Add explicit rejection coverage for removed flags in `packages/agent-remnote/tests/contract/removed-write-surface.contract.test.ts`
- [x] T041 Remove old flag parsing branches from:
  - `packages/agent-remnote/src/commands/write/rem/create.ts`
  - `packages/agent-remnote/src/commands/write/rem/move.ts`
  - `packages/agent-remnote/src/commands/write/portal/create.ts`
- [x] T042 Update command help snapshots in `packages/agent-remnote/tests/contract/help.contract.test.ts`
- [x] T043 Update invalid-option diagnostics in `packages/agent-remnote/tests/contract/invalid-options.contract.test.ts`

## Phase 6: Docs And Skill Reset

- [x] T050 Update `docs/ssot/agent-remnote/tools-write.md`
- [x] T051 [P] Update `docs/ssot/agent-remnote/cli-contract.md`
- [x] T052 [P] Create `docs/ssot/agent-remnote/write-input-surfaces.md` documenting scalar vs rich-content params, input-spec support, stdin/file semantics, heredoc suitability, and when to prefer `apply --payload`
- [x] T053 [P] Update `README.md`
- [x] T054 [P] Update `README.zh-CN.md`
- [x] T055 [P] Update `packages/agent-remnote/README.md`
- [x] T056 Update `skills/remnote/SKILL.md`
- [x] T057 Sync examples, routing language, and input-surface guidance with `specs/029-write-command-surface-reset/command-surface.md`

## Phase 7: Validation

- [x] T060 Run `npm run typecheck --workspace agent-remnote`
- [x] T061 Run targeted contract tests for `rem create`, `rem move`, and `portal create`
- [x] T062 Run help / removed-surface contract tests
- [x] T063 Run `npm run typecheck --workspace @remnote/plugin`
- [x] T064 Run targeted manual Daily Note verification for:
  - `rem create --portal at:after:...`
  - `rem move --portal in-place`
  - `portal create --to id:... --at parent[<position>]:...`
  - `rem create --from-selection --portal in-place`
