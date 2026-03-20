# Tasks: 028-rem-create-move-page-portal-flow

**Input**: Design documents from `/specs/028-rem-create-move-page-portal-flow/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/cli.md`, `quickstart.md`

**Tests**: Included. This feature changes the public agent-facing behavior of `rem create` and `rem move`.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel
- **[Story]**: User story label (`US1`, `US2`, `US3`, `US4`, `US5`)
- Every task includes exact file paths

## Phase 1: Setup

**Purpose**: Establish CLI contract scaffolding and shared validation targets.

- [x] T001 Create contract scaffolding in `packages/agent-remnote/tests/contract/rem-location-validation.contract.test.ts`
- [x] T002 [P] Create direct-create scaffolding in `packages/agent-remnote/tests/contract/rem-create-promotion.contract.test.ts`
- [x] T003 [P] Create move-promotion scaffolding in `packages/agent-remnote/tests/contract/rem-move-promotion.contract.test.ts`
- [x] T004 [P] Create selection-source scaffolding in `packages/agent-remnote/tests/contract/rem-create-selection.contract.test.ts`
- [x] T005 [P] Create explicit-target-source scaffolding in `packages/agent-remnote/tests/contract/rem-create-targets.contract.test.ts`

---

## Phase 2: Foundational

**Purpose**: Centralize dynamic normalization and validation before implementing command behavior.

**⚠️ CRITICAL**: No user story work should start until this phase is complete.

- [x] T010 Add shared intent-normalization module in `packages/agent-remnote/src/commands/write/rem/_promotion.ts`
- [x] T011 [P] Implement content-source validation (`text | markdown | targets[]`) in `packages/agent-remnote/src/commands/write/rem/_promotion.ts`
- [x] T012 [P] Implement `--from-selection -> targets[]` normalization in `packages/agent-remnote/src/commands/write/rem/_promotion.ts`
- [x] T013 [P] Implement content-placement validation (`parent | before | after | standalone`) in `packages/agent-remnote/src/commands/write/rem/_promotion.ts`
- [x] T014 [P] Implement portal-placement validation (`portal-parent | portal-before | portal-after | leave-portal*`) in `packages/agent-remnote/src/commands/write/rem/_promotion.ts`
- [x] T015 [P] Implement title-policy validation for markdown / single-target / multi-target / selection in `packages/agent-remnote/src/commands/write/rem/_promotion.ts`
- [x] T016 Wire `rem create` to the shared normalization module in `packages/agent-remnote/src/commands/write/rem/create.ts`
- [x] T017 Wire `rem move` to the shared normalization module in `packages/agent-remnote/src/commands/write/rem/move.ts`

**Checkpoint**: create/move parameter combinations are validated in one place.

---

## Phase 3: Canonical Internal Plan Surface

**Purpose**: Make `rem create` / `rem move` compile through one planner compatible with `apply`.

- [x] T020 Define canonical internal write-plan builder for create/move flows
- [x] T021 [P] Keep planner output compatible with `apply` action semantics
- [x] T022 [P] Add contract coverage proving business commands normalize to one canonical plan path

**Checkpoint**: there is one planner, not one hidden runtime branch per command.

---

## Phase 4: User Story 1 - Direct Create Writes Durable Content And Leaves A Portal (Priority: P1) 🎯 MVP

**Goal**: Allow `rem create` to create standalone durable content from markdown/text and optionally place a portal elsewhere.

**Independent Test**: one `rem create` invocation can create the durable destination and optionally insert a portal.

- [x] T030 [P] [US1] Add direct-create markdown coverage in `packages/agent-remnote/tests/contract/rem-create-promotion.contract.test.ts`
- [x] T031 [P] [US1] Add portal-placement coverage for create in `packages/agent-remnote/tests/contract/rem-location-validation.contract.test.ts`
- [x] T032 [P] [US1] Add `--markdown` title-required coverage in `packages/agent-remnote/tests/contract/rem-create-promotion.contract.test.ts`
- [x] T033 [US1] Extend `rem create` options with `--markdown`, `--standalone`, `--before`, and `--after` in `packages/agent-remnote/src/commands/write/rem/create.ts`
- [x] T034 [US1] Reuse markdown input-spec loading in `packages/agent-remnote/src/commands/write/rem/create.ts` and `packages/agent-remnote/src/commands/write/rem/children/common.ts`
- [x] T035 [US1] Implement direct markdown/text create flow through the canonical planner in `packages/agent-remnote/src/commands/write/rem/create.ts`
- [x] T036 [US1] Keep local and remote execution aligned via `packages/agent-remnote/src/lib/hostApiUseCases.ts` and `packages/agent-remnote/src/services/HostApiClient.ts`

**Checkpoint**: direct markdown create-to-standalone works with optional portal placement.

---

## Phase 5: User Story 2 - Move Promotes One Existing Rem And Leaves A Portal In Place (Priority: P1)

**Goal**: Allow `rem move` to promote one existing Rem into a standalone destination and optionally keep a portal at the original location.

**Independent Test**: one `rem move` invocation can promote a single Rem and leave a portal behind.

- [x] T040 [P] [US2] Add move-promotion contract coverage in `packages/agent-remnote/tests/contract/rem-move-promotion.contract.test.ts`
- [x] T041 [US2] Extend `rem move` options with `--standalone`, `--before`, `--after`, `--is-document`, and `--leave-portal` in `packages/agent-remnote/src/commands/write/rem/move.ts`
- [x] T042 [US2] Extend move op normalization in `packages/agent-remnote/src/kernel/op-catalog/catalog.ts`
- [x] T043 [US2] Implement standalone destination support in `packages/plugin/src/bridge/ops/handlers/remCrudOps.ts`
- [x] T044 [US2] Implement in-place portal retention for move flows in `packages/agent-remnote/src/commands/write/rem/move.ts` and `packages/plugin/src/bridge/ops/handlers/portalOps.ts`

**Checkpoint**: single-Rem promotion from DN playground becomes one stable command.

---

## Phase 6: User Story 3 - Create Can Use Existing Rem Targets Or Selection As Source (Priority: P1)

**Goal**: Let `rem create` use explicit repeated targets or selection sugar to populate a new destination.

**Independent Test**: explicit `--target` and `--from-selection` both converge to the same `targets[]` planner path.

- [x] T050 [P] [US3] Add explicit-target contract coverage in `packages/agent-remnote/tests/contract/rem-create-targets.contract.test.ts`
- [x] T051 [P] [US3] Add selection-source contract coverage in `packages/agent-remnote/tests/contract/rem-create-selection.contract.test.ts`
- [x] T052 [US3] Extend `rem create` options with repeated `--target` and `--from-selection` in `packages/agent-remnote/src/commands/write/rem/create.ts`
- [x] T053 [US3] Reuse selection-resolution helpers from `packages/agent-remnote/src/commands/write/rem/children/common.ts`
- [x] T054 [US3] Implement explicit-target source flow through the canonical planner in `packages/agent-remnote/src/commands/write/rem/create.ts`
- [x] T055 [US3] Implement `--from-selection` as pure sugar over `targets[]` in `packages/agent-remnote/src/commands/write/rem/create.ts`
- [x] T056 [US3] Fail fast on unsupported selection shapes in `packages/agent-remnote/src/commands/write/rem/_promotion.ts`

**Checkpoint**: targets and selection no longer drift into two separate create implementations.

---

## Phase 7: User Story 4 - Location Semantics Stay Consistent Across Create, Move, And Portal Placement (Priority: P2)

**Goal**: Keep content placement and portal placement parallel and predictable.

**Independent Test**: invalid or ambiguous parameter combinations fail fast with stable diagnostics.

- [x] T060 [P] [US4] Add ambiguity coverage in `packages/agent-remnote/tests/contract/rem-location-validation.contract.test.ts`
- [x] T061 [US4] Implement anchor-relative placement resolution for `before/after` in `packages/agent-remnote/src/commands/write/rem/_promotion.ts`
- [x] T062 [US4] Keep receipt-visible source/anchor context in `packages/agent-remnote/src/commands/write/rem/create.ts` and `packages/agent-remnote/src/commands/write/rem/move.ts`

**Checkpoint**: agents can reason about one unified placement model.

---

## Phase 8: User Story 5 - Partial Success Remains Diagnosable (Priority: P2)

**Goal**: Preserve durable content while returning clear receipts when portal-related steps fail.

**Independent Test**: durable target ids remain visible in receipts even when portal insertion fails.

- [x] T070 [P] [US5] Add partial-success receipt coverage in `packages/agent-remnote/tests/contract/rem-create-promotion.contract.test.ts` and `packages/agent-remnote/tests/contract/rem-move-promotion.contract.test.ts`
- [x] T071 [US5] Define stable receipt enrichment in `packages/agent-remnote/src/commands/write/rem/create.ts`
- [x] T072 [US5] Define stable receipt enrichment in `packages/agent-remnote/src/commands/write/rem/move.ts`
- [x] T073 [US5] Surface `warnings` and `nextActions` for half-finished create/move flows through `packages/agent-remnote/src/commands/_shared.ts` and queue inspection paths

**Checkpoint**: agent-facing diagnostics are strong enough for half-finished flows.

---

## Phase 9: Docs & Skill Sync

**Purpose**: Align SSoT, README surfaces, and RemNote skill guidance with the new contract.

- [x] T080 Update `docs/ssot/agent-remnote/tools-write.md`
- [x] T081 [P] Update `docs/ssot/agent-remnote/cli-contract.md`
- [x] T082 [P] Update `README.md`, `README.zh-CN.md`, and `README.local.md`
- [x] T083 Update `skills/remnote/SKILL.md` routing so it prefers the new `rem create` / `rem move` promotion flows over legacy multi-step guidance
- [x] T084 Update `skills/remnote/SKILL.md` examples and defaults so `--is-document` is treated as opt-in, explicit `--target` is documented, and `--from-selection` is explained as sugar over the same source model

---

## Phase 10: Effect Practice Alignment

**Purpose**: After implementation is done, verify that the architecture aligns with the repository's intended Effect style instead of freezing ad-hoc imperative branching.

- [x] T085 Review the final implementation against Effect best practices and capture the architectural alignment notes in `specs/028-rem-create-move-page-portal-flow/effect-alignment.md`
- [x] T086 Identify any remaining imperative validation / planning leakage and record concrete follow-up cleanup items in `specs/028-rem-create-move-page-portal-flow/effect-alignment.md`
- [ ] T087 Verify that `skills/remnote/SKILL.md` no longer carries business-truth validation that now belongs in the CLI/runtime contract

---

## Final Phase: Validation

**Purpose**: Prove local and stability behavior before merge.

- [x] T090 Run `npm run typecheck --workspace agent-remnote`
- [x] T091 Run targeted contract tests for create/move promotion flows
- [x] T092 Run `npm test --workspace agent-remnote -- write-wait.contract.test.ts`
- [x] T093 Run `node ./scripts/repeat-command.mjs 10 npm test --workspace agent-remnote -- write-wait.contract.test.ts`
- [x] T094 Run `npm run ci:premerge:raw`
