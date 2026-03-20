# Tasks: 025-write-receipt-id-map

**Input**: Design documents from `/specs/025-write-receipt-id-map/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/cli.md`, `quickstart.md`

**Tests**: Included. This feature changes the canonical machine-readable wait-mode receipt contract.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel
- **[Story]**: User story label (`US1`, `US2`, `US3`)
- Every task includes exact file paths

## Phase 1: Setup

**Purpose**: Establish contract coverage for canonical `id_map` receipts.

- [x] T001 Create canonical receipt contract scaffolding in `packages/agent-remnote/tests/contract/write-wait.contract.test.ts`
- [x] T002 [P] Extend receipt-shape coverage in `packages/agent-remnote/tests/contract/ids-output.contract.test.ts`

---

## Phase 2: Foundational

**Purpose**: Define one shared machine-readable receipt assembly path centered on `id_map`.

**⚠️ CRITICAL**: No user story work should start until this phase is complete.

- [x] T010 Add shared canonical receipt assembly in `packages/agent-remnote/src/commands/_waitTxn.ts`
- [x] T011 [P] Thread canonical receipt data through `packages/agent-remnote/src/commands/queue/wait.ts`
- [x] T012 [P] Keep local and remote receipt payload shapes aligned in `packages/agent-remnote/src/lib/hostApiUseCases.ts`, `packages/agent-remnote/src/services/HostApiClient.ts`, and `packages/agent-remnote/src/runtime/http-api/runHttpApiRuntime.ts`

**Checkpoint**: wait-mode writes can produce one canonical `id_map`-centered receipt.

---

## Phase 3: User Story 1 - `id_map` Is the Canonical Success Contract (Priority: P1) 🎯 MVP

**Goal**: Make `id_map` the default machine-readable continuation contract.

**Independent Test**: successful wait-mode wrapper commands and `apply` all expose `id_map` directly.

- [x] T020 [P] [US1] Add success-receipt coverage for canonical `id_map` in `packages/agent-remnote/tests/contract/write-wait.contract.test.ts`
- [x] T021 [P] [US1] Add `apply --wait` canonical `id_map` coverage in `packages/agent-remnote/tests/contract/api-write-apply.contract.test.ts`
- [x] T022 [US1] Return canonical `id_map` directly from successful wait-mode flows in `packages/agent-remnote/src/commands/_waitTxn.ts` and `packages/agent-remnote/src/commands/apply.ts`

**Checkpoint**: agents can parse `id_map` first across wait-mode success paths.

---

## Phase 4: User Story 2 - Local and Remote Receipts Share One Machine Contract (Priority: P1)

**Goal**: Keep canonical `id_map` semantics identical across local and remote surfaces.

**Independent Test**: local and remote `apply --wait` results share the same `id_map` contract.

- [x] T030 [P] [US2] Add local vs remote parity coverage in `packages/agent-remnote/tests/contract/api-write-apply.contract.test.ts` and `packages/agent-remnote/tests/contract/queue-wait-remote-api.contract.test.ts`
- [x] T031 [US2] Align Host API receipt shaping in `packages/agent-remnote/src/lib/hostApiUseCases.ts`, `packages/agent-remnote/src/services/HostApiClient.ts`, and `packages/agent-remnote/src/runtime/http-api/runHttpApiRuntime.ts`
- [x] T032 [US2] Update docs to describe one machine contract in `docs/ssot/agent-remnote/http-api-contract.md`, `README.md`, `README.zh-CN.md`, and `README.local.md`

**Checkpoint**: parser logic does not branch on local vs remote mode.

---

## Phase 5: User Story 3 - Convenience IDs Stay Secondary (Priority: P2)

**Goal**: Preserve compatibility without letting wrapper sugar become the primary contract.

**Independent Test**: any retained convenience ids are clearly documented and validated as derived from `id_map`.

- [x] T040 [P] [US3] Add consistency coverage between `id_map` and convenience ids in `packages/agent-remnote/tests/contract/ids-output.contract.test.ts`
- [x] T041 [US3] Keep wrapper convenience ids derived from canonical receipt assembly in `packages/agent-remnote/src/commands/write/rem/create.ts` and `packages/agent-remnote/src/commands/write/portal/create.ts`
- [x] T042 [US3] Update quickstart and skill guidance so `id_map` is the primary machine contract in `specs/025-write-receipt-id-map/quickstart.md` and `skills/remnote/SKILL.md`

**Checkpoint**: convenience ids remain optional sugar, not the parser center.
