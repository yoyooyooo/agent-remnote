# Tasks: 024-agent-first-composite-writes

**Input**: Design documents from `/specs/024-agent-first-composite-writes/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/cli.md`, `quickstart.md`

**Tests**: Included. This feature changes the agent-facing action vocabulary for `apply`.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel
- **[Story]**: User story label (`US1`, `US2`, `US3`)
- Every task includes exact file paths

## Phase 1: Setup

**Purpose**: Establish contract coverage for the new atomic portal action.

- [x] T001 Create atomic portal-action contract scaffolding in `packages/agent-remnote/tests/contract/write-plan.contract.test.ts`
- [x] T002 [P] Create remote apply parity scaffolding in `packages/agent-remnote/tests/contract/api-write-apply.contract.test.ts`

---

## Phase 2: Foundational

**Purpose**: Wire one canonical portal action into the action compiler.

**⚠️ CRITICAL**: No user story work should start until this phase is complete.

- [x] T010 Add the canonical `portal.create` action spec in `packages/agent-remnote/src/kernel/write-plan/compile.ts`
- [x] T011 [P] Keep action-envelope parsing aligned in `packages/agent-remnote/src/commands/_applyEnvelope.ts`
- [x] T012 [P] Keep local and remote `writeApply` transport aligned in `packages/agent-remnote/src/commands/apply.ts`, `packages/agent-remnote/src/lib/hostApiUseCases.ts`, and `packages/agent-remnote/src/services/HostApiClient.ts`

**Checkpoint**: `apply` accepts one canonical atomic portal action.

---

## Phase 3: User Story 1 - One Canonical Portal Action in `apply` (Priority: P1) 🎯 MVP

**Goal**: Expose portal insertion as an atomic `apply` action.

**Independent Test**: `apply --dry-run` and real execution both treat `portal.create` as a first-class action.

- [x] T020 [P] [US1] Add dry-run and execution coverage for `portal.create` in `packages/agent-remnote/tests/contract/write-plan.contract.test.ts`
- [x] T021 [P] [US1] Add remote parity coverage for the same atomic action in `packages/agent-remnote/tests/contract/api-write-apply.contract.test.ts`
- [x] T022 [US1] Compile `portal.create` to `create_portal` in `packages/agent-remnote/src/kernel/write-plan/compile.ts`

**Checkpoint**: the missing atomic capability is present.

---

## Phase 4: User Story 2 - Portal Action Supports Alias-Based Composition (Priority: P1)

**Goal**: Let the new atomic action compose with existing atomic actions through aliases.

**Independent Test**: a portal action can reference earlier aliases in `parent_id` and `target_rem_id`.

- [x] T030 [P] [US2] Add alias-based portal-action coverage in `packages/agent-remnote/tests/contract/write-plan.contract.test.ts`
- [x] T031 [US2] Allow earlier-alias substitution in `packages/agent-remnote/src/kernel/write-plan/compile.ts`
- [x] T032 [US2] Fail fast on unresolved aliases in `packages/agent-remnote/src/commands/apply.ts` and `packages/agent-remnote/src/commands/_applyEnvelope.ts`

**Checkpoint**: atomic actions remain composable without new workflow nouns.

---

## Phase 5: User Story 3 - Skills Own Scenario Composition (Priority: P2)

**Goal**: Keep scenario-level workflows out of the CLI contract.

**Independent Test**: docs and skill guidance describe `portal.create` as an atomic capability, not a workflow command.

- [x] T040 [US3] Update `docs/ssot/agent-remnote/tools-write.md` and `docs/ssot/agent-remnote/cli-contract.md`
- [x] T041 [P] [US3] Update README surfaces in `README.md`, `README.zh-CN.md`, and `README.local.md`
- [x] T042 [US3] Update `~/.codex/skills/remnote/SKILL.md` so scenario composition stays in Skill guidance

**Checkpoint**: CLI remains minimal, Skills remain compositional.
