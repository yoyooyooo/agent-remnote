# Tasks: 026-recent-activity-summaries

**Input**: Design documents from `/specs/026-recent-activity-summaries/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/cli.md`, `quickstart.md`

**Tests**: Included. This feature changes the normalized recent-activity query contract.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel
- **[Story]**: User story label (`US1`, `US2`, `US3`)
- Every task includes exact file paths

## Phase 1: Setup

**Purpose**: Establish contract coverage for the normalized query surface.

- [x] T001 Create normalized recent-activity contract scaffolding in `packages/agent-remnote/tests/contract/db-recent.contract.test.ts`

---

## Phase 2: Foundational

**Purpose**: Define one normalized recent-activity query model and one normalized result schema.

**⚠️ CRITICAL**: No user story work should start until this phase is complete.

- [x] T010 Add shared normalized recent-activity helpers in `packages/agent-remnote/src/internal/remdb-tools/summarizeRecentActivity.ts`
- [x] T011 [P] Thread generic query dimensions through `packages/agent-remnote/src/commands/read/db/recent.ts`

**Checkpoint**: one stable normalized query schema exists.

---

## Phase 3: User Story 1 - Normalized Recent Activity Items (Priority: P1) 🎯 MVP

**Goal**: Return one typed `items[]` collection.

**Independent Test**: each returned item has explicit `activity_kind`.

- [x] T020 [P] [US1] Add normalized `items[]` coverage in `packages/agent-remnote/tests/contract/db-recent.contract.test.ts`
- [x] T021 [US1] Implement normalized activity items in `packages/agent-remnote/src/internal/remdb-tools/summarizeRecentActivity.ts`
- [x] T022 [US1] Surface stable `items[]` output in `packages/agent-remnote/src/commands/read/db/recent.ts`

---

## Phase 4: User Story 2 - Generic Aggregate Dimensions (Priority: P1)

**Goal**: Return one normalized `aggregates[]` collection driven by generic aggregate dimensions.

**Independent Test**: `--aggregate day` and `--aggregate parent` both map into the same `aggregates[]` schema.

- [x] T030 [P] [US2] Add normalized aggregate coverage in `packages/agent-remnote/tests/contract/db-recent.contract.test.ts`
- [x] T031 [US2] Implement generic aggregate-dimension handling in `packages/agent-remnote/src/internal/remdb-tools/summarizeRecentActivity.ts`
- [x] T032 [US2] Surface stable `aggregates[]` output in `packages/agent-remnote/src/commands/read/db/recent.ts`

---

## Phase 5: User Story 3 - Generic Output Shaping (Priority: P2)

**Goal**: Bound output through generic limits without changing the normalized schema.

**Independent Test**: limits reduce volume but do not alter top-level result structure.

- [x] T040 [P] [US3] Add limit-handling coverage in `packages/agent-remnote/tests/contract/db-recent.contract.test.ts`
- [x] T041 [US3] Implement generic item and aggregate limits in `packages/agent-remnote/src/commands/read/db/recent.ts`
- [x] T042 [US3] Update docs to describe normalized query primitives in `README.md`, `README.zh-CN.md`, and `README.local.md`
- [x] T043 [US3] Sync `docs/ssot/agent-remnote/**` for `db recent` wire contract changes
