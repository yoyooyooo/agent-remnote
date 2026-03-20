# Tasks: 027-portal-outline-observability

**Input**: Design documents from `/specs/027-portal-outline-observability/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/cli.md`, `quickstart.md`

**Tests**: Included. This feature changes the outline node schema.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel
- **[Story]**: User story label (`US1`, `US2`, `US3`)
- Every task includes exact file paths

## Phase 1: Setup

**Purpose**: Establish typed-node contract coverage.

- [x] T001 Create typed-node outline contract scaffolding in `packages/agent-remnote/tests/contract/outline-portal.contract.test.ts`

---

## Phase 2: Foundational

**Purpose**: Define one typed node schema with optional target metadata.

**⚠️ CRITICAL**: No user story work should start until this phase is complete.

- [x] T010 Add typed-node enrichment in `packages/agent-remnote/src/internal/remdb-tools/outlineRemSubtree.ts`
- [x] T011 [P] Thread typed-node metadata through local and remote outline use cases in `packages/agent-remnote/src/lib/hostApiUseCases.ts` and `packages/agent-remnote/src/services/HostApiClient.ts`

**Checkpoint**: outline has one stable typed node schema.

---

## Phase 3: User Story 1 - Outline Nodes Become Explicitly Typed (Priority: P1) 🎯 MVP

**Goal**: Make machine-readable outline output explicitly typed.

**Independent Test**: every returned node has a `kind`.

- [x] T020 [P] [US1] Add typed-node coverage in `packages/agent-remnote/tests/contract/outline-portal.contract.test.ts`
- [x] T021 [US1] Implement explicit node-kind output in `packages/agent-remnote/src/internal/remdb-tools/outlineRemSubtree.ts`
- [x] T022 [US1] Keep markdown and JSON/detail output aligned with typed-node semantics in `packages/agent-remnote/src/internal/remdb-tools/outlineRemSubtree.ts`

---

## Phase 4: User Story 2 - Target-Bearing Nodes Expose Optional Target Metadata (Priority: P1)

**Goal**: Expose target metadata generically for target-bearing nodes.

**Independent Test**: portal nodes surface `target` metadata through the generic node schema.

- [x] T030 [P] [US2] Add target-metadata coverage in `packages/agent-remnote/tests/contract/outline-portal.contract.test.ts`
- [x] T031 [US2] Implement optional `target` metadata in `packages/agent-remnote/src/internal/remdb-tools/outlineRemSubtree.ts`
- [x] T032 [US2] Implement explicit unresolved-target markers in `packages/agent-remnote/src/internal/remdb-tools/outlineRemSubtree.ts`

---

## Phase 5: User Story 3 - Existing Outline Surface Supports CLI-Only Verification (Priority: P2)

**Goal**: Keep verification composition in docs and Skills, not in new commands.

**Independent Test**: docs and quickstart rely on the richer node schema and the existing outline surface only.

- [x] T040 [P] [US3] Add remote parity coverage in `packages/agent-remnote/tests/contract/outline-remote-api.contract.test.ts`
- [x] T041 [US3] Update docs and quickstart in `README.md`, `README.zh-CN.md`, `README.local.md`, `docs/ssot/agent-remnote/cli-contract.md`, `docs/ssot/agent-remnote/tools-write.md`, and `specs/027-portal-outline-observability/quickstart.md`
- [x] T042 [US3] Update `skills/remnote/SKILL.md` so verification stays based on typed outline nodes
