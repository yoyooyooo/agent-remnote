# Tasks: 030-remnote-business-command-mode-parity

**Input**: Design documents from `/specs/030-remnote-business-command-mode-parity/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/parity-matrix.md`, `quickstart.md`

**Tests**: Included. This feature requires command-level remote-first integration verification, success/failure comparison tests, drift checks between authoritative inventory and code artifacts, plus architecture-guard tests that block residual command-layer mode branching.

**Organization**: Tasks are grouped by phase and user story so each parity milestone can be implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel
- **[Story]**: Which user story this task belongs to (`US1`, `US2`, `US3`, `US4`)
- Include exact file paths in descriptions

## Phase 1: Setup

- [x] T001 Create command-inventory classification scaffolding in `packages/agent-remnote/tests/contract/remnote-business-command-classification.contract.test.ts`
- [x] T002 [P] Create Wave 1 executable-contract scaffolding in `packages/agent-remnote/tests/contract/remnote-business-command-contracts.contract.test.ts` and `packages/agent-remnote/tests/helpers/remnoteBusinessCommandContracts.ts`
- [x] T003 [P] Create command-layer architecture-guard scaffolding in `packages/agent-remnote/tests/contract/remnote-business-command-architecture.contract.test.ts`
- [x] T004 [P] Create command-level parity contract scaffolding in `packages/agent-remnote/tests/contract/remnote-business-command-parity.contract.test.ts`
- [x] T005 [P] Create remote-first integration scaffolding in `packages/agent-remnote/tests/integration/remnote-business-command-mode-parity.integration.test.ts`
- [x] T006 [P] Create parity helper scaffolding in `packages/agent-remnote/tests/helpers/remnoteBusinessCommandMatrix.ts`, `packages/agent-remnote/tests/helpers/remoteModeHarness.ts`, `packages/agent-remnote/tests/helpers/parityFixtureBuilders.ts`, and `packages/agent-remnote/tests/helpers/parityComparison.ts`

---

## Phase 2: Foundational Docs & Inventory (Blocking Prerequisites)

**Purpose**: Freeze authoritative inventory, governance, and S-grade architecture boundaries before runtime migration begins.

**⚠️ CRITICAL**: No Wave 1 runtime migration should start until this phase is complete.

- [x] T010 Define the sole authoritative command-level inventory in `docs/ssot/agent-remnote/runtime-mode-and-command-parity.md`
- [x] T011 [P] Derive the feature-local migration ledger in `specs/030-remnote-business-command-mode-parity/contracts/parity-matrix.md`
- [x] T012 [P] Add the machine-readable derived mirror in `packages/agent-remnote/src/lib/business-semantics/commandInventory.ts` and drift assertions in `packages/agent-remnote/tests/contract/remnote-business-command-classification.contract.test.ts`
- [x] T013 [P] Update governance docs in `.specify/memory/constitution.md` and `specs/README.md`
- [x] T014 [P] Update boundary and parity SSoT in `docs/ssot/agent-remnote/http-api-contract.md`, `docs/ssot/agent-remnote/cli-contract.md`, `docs/ssot/agent-remnote/tools-write.md`, `docs/ssot/agent-remnote/ui-context-and-persistence.md`, and `docs/ssot/agent-remnote/write-input-surfaces.md`
- [x] T015 [P] Update overview docs in `docs/ssot/agent-remnote/README.md`, `README.md`, `README.zh-CN.md`, and `packages/agent-remnote/README.md`
- [x] T016 [P] Update repo-local routing guidance in `skills/remnote/SKILL.md`
- [x] T017 Produce an inventory-closure report for all current `failInRemoteMode` / `remoteModeUnsupportedError` callsites under `packages/agent-remnote/src/commands/**` and `packages/agent-remnote/src/services/**`, then record fix/reclassify targets in `specs/030-remnote-business-command-mode-parity/contracts/parity-matrix.md`
- [x] T018 Upgrade `specs/030-remnote-business-command-mode-parity/spec.md`, `specs/030-remnote-business-command-mode-parity/plan.md`, `specs/030-remnote-business-command-mode-parity/research.md`, `specs/030-remnote-business-command-mode-parity/data-model.md`, `specs/030-remnote-business-command-mode-parity/contracts/parity-matrix.md`, `specs/030-remnote-business-command-mode-parity/quickstart.md`, and `specs/030-remnote-business-command-mode-parity/tasks.md` to the S-grade architecture that requires one executable contract registry, one `ModeParityRuntime`, and one architecture gate

**Checkpoint**: One authoritative inventory exists, the 030 doc set reflects the S-grade target architecture, and no boundary ambiguity remains.

---

## Phase 3: User Story 1 - Command Inventory And Boundary Clarity (Priority: P1)

**Goal**: Make the business-command set, operational exclusions, parity targets, and Wave 1 executable coverage explicit and drift-checked.

**Independent Test**: The authoritative inventory and Wave 1 executable registry can be traversed command by command, and docs/tests fail on undocumented drift.

- [x] T020 [P] [US1] Add command-row coverage and docs-drift assertions in `packages/agent-remnote/tests/contract/remnote-business-command-classification.contract.test.ts`
- [x] T021 [US1] Map each Wave 1 command row to at least one verification case in `packages/agent-remnote/tests/helpers/remnoteBusinessCommandMatrix.ts`
- [x] T022 [US1] Map each deferred command row to one explicit next-step decision in `specs/030-remnote-business-command-mode-parity/contracts/parity-matrix.md`
- [x] T023 [US1] Sync business-vs-operational and wave-language in `docs/ssot/agent-remnote/runtime-mode-and-command-parity.md`, `docs/ssot/agent-remnote/http-api-contract.md`, and `skills/remnote/SKILL.md`
- [x] T024 [US1] Add Wave 1 inventory -> executable registry alignment assertions in `packages/agent-remnote/tests/contract/remnote-business-command-contracts.contract.test.ts`
- [x] T025 [US1] Add Wave 1 inventory -> verification-case coverage assertions in `packages/agent-remnote/tests/helpers/remnoteBusinessCommandContracts.ts` and `packages/agent-remnote/tests/helpers/remnoteBusinessCommandMatrix.ts`

**Checkpoint**: The repository has one command-level, test-backed answer for what the parity contract covers and how Wave 1 executable rows align with it.

---

## Phase 4: Foundational Runtime Spine (Blocking Prerequisites)

**Purpose**: Build the executable contract spine and central runtime before migrating Wave 1 commands.

**⚠️ CRITICAL**: No broad Wave 1 command migration should start until this phase is complete.

- [x] T030 [P] Define the Wave 1 executable registry in `packages/agent-remnote/src/lib/business-semantics/commandContracts.ts`
- [x] T031 [P] Define the unique Wave 1 runtime in `packages/agent-remnote/src/lib/business-semantics/modeParityRuntime.ts`
- [x] T032 [P] Add the local runtime adapter in `packages/agent-remnote/src/lib/business-semantics/localModeAdapter.ts`
- [x] T033 [P] Add the remote runtime adapter in `packages/agent-remnote/src/lib/business-semantics/remoteModeAdapter.ts`
- [x] T034 [P] Add runtime capability guards and normalization helpers in `packages/agent-remnote/src/lib/business-semantics/capabilityGuards.ts`
- [x] T035 Add registry alignment tests in `packages/agent-remnote/tests/contract/remnote-business-command-contracts.contract.test.ts`
- [x] T036 Add architecture-guard tests in `packages/agent-remnote/tests/contract/remnote-business-command-architecture.contract.test.ts` that block direct `cfg.apiBaseUrl` reads and direct `HostApiClient` usage inside Wave 1 command files
- [x] T037 Refactor shared orchestration entry points in `packages/agent-remnote/src/lib/hostApiUseCases.ts`, `packages/agent-remnote/src/commands/apply.ts`, `packages/agent-remnote/src/commands/queue/wait.ts`, and `packages/agent-remnote/src/commands/write/rem/children/common.ts` so they can be consumed through the runtime instead of bespoke mode branches

**Checkpoint**: Wave 1 has one executable registry, one runtime, one pair of adapters, and automated guardrails that block command-layer mode branching.

---

## Phase 5: User Story 3 - Host-Authoritative Semantic Extraction (Priority: P1)

**Goal**: Keep host-dependent business semantics single-sourced behind runtime capabilities.

**Independent Test**: Semantic modules become the only authoritative owners for ref, placement, selection, title, receipt, and capability gating rules.

- [x] T040 [P] [US3] Extract host-authoritative ref semantics into `packages/agent-remnote/src/lib/business-semantics/refResolution.ts` and adapt `packages/agent-remnote/src/services/RefResolver.ts`
- [x] T041 [P] [US3] Extract host-authoritative placement semantics into `packages/agent-remnote/src/lib/business-semantics/placementResolution.ts` and adapt `packages/agent-remnote/src/commands/write/_placementSpec.ts`
- [x] T042 [P] [US3] Extract host-authoritative selection semantics into `packages/agent-remnote/src/lib/business-semantics/selectionResolution.ts` and adapt `packages/agent-remnote/src/commands/read/selection/_shared.ts`, `packages/agent-remnote/src/commands/read/uiContext/_shared.ts`, and related selection helpers
- [x] T043 [P] [US3] Extract title inference and receipt enrichment into `packages/agent-remnote/src/lib/business-semantics/titleInference.ts` and `packages/agent-remnote/src/lib/business-semantics/receiptBuilders.ts`
- [x] T044 [US3] Wire semantic modules into `packages/agent-remnote/src/lib/business-semantics/modeParityRuntime.ts`, `packages/agent-remnote/src/lib/business-semantics/localModeAdapter.ts`, and `packages/agent-remnote/src/lib/business-semantics/remoteModeAdapter.ts`
- [x] T045 [US3] Remove residual host-fact business logic from `packages/agent-remnote/src/commands/write/rem/_promotion.ts`, `packages/agent-remnote/src/commands/write/_shared.ts`, and related helpers once semantic owners exist

**Checkpoint**: Shared business semantics are single-sourced, and the runtime owns their execution and normalization.

---

## Phase 6: User Story 2A - Wave 1 Read / Context Commands Stay Mode-Invariant (Priority: P1)

**Goal**: Migrate Wave 1 read and UI-context commands onto the runtime and executable registry.

**Independent Test**: Wave 1 read/context commands using advanced refs, workspace binding, selection, and UI-context behave the same with and without `apiBaseUrl`.

- [x] T050 [P] [US2] Add Wave 1 read/context contract rows to `packages/agent-remnote/src/lib/business-semantics/commandContracts.ts`
- [x] T051 [P] [US2] Add runtime capability bindings for read/context flows in `packages/agent-remnote/src/lib/business-semantics/modeParityRuntime.ts`, `packages/agent-remnote/src/lib/business-semantics/localModeAdapter.ts`, and `packages/agent-remnote/src/lib/business-semantics/remoteModeAdapter.ts`
- [x] T052 [US2] Add or complete Host API route/schema/runtime support for Wave 1 ref/search/context reads in `packages/agent-remnote/src/lib/hostApiUseCases.ts`, `packages/agent-remnote/src/runtime/http-api/runHttpApiRuntime.ts`, and `packages/agent-remnote/src/services/HostApiClient.ts`
- [x] T053 [US2] Migrate `packages/agent-remnote/src/commands/read/search.ts`, `packages/agent-remnote/src/commands/read/outline.ts`, `packages/agent-remnote/src/commands/read/page-id.ts`, `packages/agent-remnote/src/commands/read/by-reference.ts`, `packages/agent-remnote/src/commands/read/references.ts`, `packages/agent-remnote/src/commands/read/resolve-ref.ts`, and `packages/agent-remnote/src/commands/read/query.ts` onto the runtime
- [x] T054 [US2] Migrate `packages/agent-remnote/src/commands/plugin/current.ts`, `packages/agent-remnote/src/commands/plugin/search.ts`, `packages/agent-remnote/src/commands/read/uiContext/*.ts`, and `packages/agent-remnote/src/commands/read/selection/*.ts` onto the runtime
- [x] T055 [US2] Remove residual direct mode branching from migrated Wave 1 read/context command files and make `packages/agent-remnote/tests/contract/remnote-business-command-architecture.contract.test.ts` enforce the invariant

**Checkpoint**: Wave 1 read/context commands no longer change semantic behavior when `apiBaseUrl` is configured, and their command files are transport-thin.

---

## Phase 7: User Story 2B - Wave 1 Write Commands Stay Mode-Invariant (Priority: P1)

**Goal**: Migrate Wave 1 write commands onto the runtime while preserving the existing apply/write-plan pipeline.

**Independent Test**: Wave 1 writes using refs, placement, selection, portals, receipts, and stable failures behave the same with and without `apiBaseUrl`.

- [x] T060 [P] [US2] Add Wave 1 write contract rows to `packages/agent-remnote/src/lib/business-semantics/commandContracts.ts`
- [x] T061 [P] [US2] Add runtime capability bindings for write flows in `packages/agent-remnote/src/lib/business-semantics/modeParityRuntime.ts`, `packages/agent-remnote/src/lib/business-semantics/localModeAdapter.ts`, and `packages/agent-remnote/src/lib/business-semantics/remoteModeAdapter.ts`
- [x] T062 [US2] Route canonical write capability support through `packages/agent-remnote/src/lib/hostApiUseCases.ts`, `packages/agent-remnote/src/runtime/http-api/runHttpApiRuntime.ts`, `packages/agent-remnote/src/services/HostApiClient.ts`, and `packages/agent-remnote/src/commands/_applyEnvelope.ts` while preserving `apply envelope -> WritePlanV1 -> ops`
- [x] T063 [US2] Migrate `packages/agent-remnote/src/commands/daily/write.ts`, `packages/agent-remnote/src/commands/apply.ts`, and `packages/agent-remnote/src/commands/queue/wait.ts` onto the runtime
- [x] T064 [US2] Migrate `packages/agent-remnote/src/commands/write/rem/create.ts`, `packages/agent-remnote/src/commands/write/rem/move.ts`, `packages/agent-remnote/src/commands/write/portal/create.ts`, `packages/agent-remnote/src/commands/write/rem/replace.ts`, `packages/agent-remnote/src/commands/write/rem/children/*.ts`, `packages/agent-remnote/src/commands/write/rem/text.ts`, `packages/agent-remnote/src/commands/write/rem/delete.ts`, and `packages/agent-remnote/src/commands/write/tag/index.ts` onto the runtime
- [x] T065 [US2] Rewrite existing local-only / partial-remote assertions, help output, and docs for Wave 1 write commands in `packages/agent-remnote/tests/contract/*remote-api*.test.ts`, `packages/agent-remnote/tests/contract/remote-mode-local-read-guard.contract.test.ts`, `packages/agent-remnote/tests/contract/help.contract.test.ts`, and related README/help docs
- [x] T066 [US2] Remove residual business-side `cfg.apiBaseUrl` branching from write helpers, including `packages/agent-remnote/src/commands/write/rem/_promotion.ts`

**Checkpoint**: Wave 1 write commands no longer lose capability or change semantic behavior when `apiBaseUrl` is configured, and command-layer mode switches are gone.

---

## Phase 8: User Story 3B - Deferred Command Decisions & Remote Guard Reconciliation (Priority: P1)

**Goal**: Keep deferred-wave boundaries explicit and make host-only or stable-failure behavior match the declared inventory target.

**Independent Test**: Deferred commands have explicit targets, and no deferred command remains in a gray zone between business/runtime and host-only behavior.

- [x] T070 [P] [US3] Reconcile remote guards and classification for deferred commands in `packages/agent-remnote/src/commands/_remoteMode.ts`, `packages/agent-remnote/src/services/RemDb.ts`, and deferred command entry files so each deferred command matches its declared target
- [x] T071 [US3] Record follow-up wave decisions and rationale in `docs/ssot/agent-remnote/runtime-mode-and-command-parity.md` and `specs/030-remnote-business-command-mode-parity/contracts/parity-matrix.md`
- [x] T072 [US3] Add guard assertions that block new business commands without inventory rows, executable-registry decisions, or verification cases in `packages/agent-remnote/tests/contract/remnote-business-command-classification.contract.test.ts` and `packages/agent-remnote/tests/contract/remnote-business-command-contracts.contract.test.ts`

**Checkpoint**: Shared business semantics are single-sourced, and every non-Wave-1 command has an explicit next step.

---

## Phase 9: User Story 4 - Remote-First Verification Prevents Drift (Priority: P2)

**Goal**: Add a deterministic, command-level remote-first gate that proves Wave 1 parity and the intended architecture shape.

**Independent Test**: With `apiBaseUrl` configured, the remote-first suite runs every Wave 1 command under both `/v1` and `/remnote/v1`, compares success and stable-failure outcomes, and validates registry/runtime architecture invariants.

- [x] T080 [P] [US4] Finalize the command-level verification matrix in `packages/agent-remnote/tests/helpers/remnoteBusinessCommandMatrix.ts`
- [x] T081 [P] [US4] Finalize the executable contract helper view in `packages/agent-remnote/tests/helpers/remnoteBusinessCommandContracts.ts`
- [x] T082 [P] [US4] Finalize the deterministic remote harness in `packages/agent-remnote/tests/helpers/remoteModeHarness.ts`
- [x] T083 [P] [US4] Finalize the deterministic hierarchy, selection, UI-context, partial-success, and base-path fixtures in `packages/agent-remnote/tests/helpers/parityFixtureBuilders.ts`
- [x] T084 [P] [US4] Finalize success and stable-failure comparison rules in `packages/agent-remnote/tests/helpers/parityComparison.ts`
- [x] T085 [US4] Implement command-level direct-vs-remote success comparisons in `packages/agent-remnote/tests/contract/remnote-business-command-parity.contract.test.ts`
- [x] T086 [US4] Implement command-level direct-vs-remote stable-failure comparisons in `packages/agent-remnote/tests/contract/remnote-business-command-parity.contract.test.ts`
- [x] T087 [US4] Implement default `/v1` remote-first integration coverage in `packages/agent-remnote/tests/integration/remnote-business-command-mode-parity.integration.test.ts`
- [x] T088 [US4] Implement non-default `/remnote/v1` coverage in `packages/agent-remnote/tests/integration/remnote-business-command-mode-parity.integration.test.ts` and `packages/agent-remnote/tests/unit/host-api-client.unit.test.ts`
- [x] T089 [US4] Update verification entry points in `specs/030-remnote-business-command-mode-parity/quickstart.md` and repository docs so the deterministic gate, executable-registry checks, architecture guards, and manual host smoke are all documented

**Checkpoint**: The repository can prove Wave 1 parity at command level under both base-path variants and can automatically reject architecture regressions.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [x] T090 [P] Run targeted typecheck and focused contract suites with `npm run typecheck --workspace agent-remnote` and `npm test --workspace agent-remnote -- <paths>`
- [x] T091 Run the full package test suite with `npm test --workspace agent-remnote`
- [x] T092 Run the deterministic remote-first gate under both base-path variants per `specs/030-remnote-business-command-mode-parity/quickstart.md`
- [x] T093 Verify docs/skill drift is closed across `docs/ssot/agent-remnote/**`, `README.md`, `README.zh-CN.md`, `packages/agent-remnote/README.md`, and `skills/remnote/SKILL.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational Docs & Inventory (Phase 2)**: Depends on Setup and blocks all later work
- **US1 Inventory Clarity (Phase 3)**: Depends on Foundational Docs & Inventory
- **Foundational Runtime Spine (Phase 4)**: Depends on Phase 2 and blocks broad Wave 1 migration
- **US3 Semantic Extraction (Phase 5)**: Depends on Phase 4 because semantic modules must attach to the runtime spine
- **US2A/US2B Wave 1 Migration (Phases 6-7)**: Depend on Phases 3-5
- **US3 Deferred Decisions (Phase 8)**: Depends on the runtime spine and enough Wave 1 migration to make boundaries explicit
- **US4 Verification Gate (Phase 9)**: Depends on US1 + runtime spine + Wave 1 migration because the gate validates the final Wave 1 command set and architecture rules
- **Polish (Phase 10)**: Depends on all desired stories being complete

### Parallel Opportunities

- Foundational docs updates marked `[P]` can run in parallel
- Runtime adapter and guard scaffolding can run in parallel after the inventory freezes
- Semantic extraction tasks T040-T043 can run in parallel once the runtime spine exists
- Read-path and write-path migration can proceed in parallel after shared semantics land
- Deterministic fixture and harness work in US4 can proceed in parallel before the final assertions are written

## Implementation Strategy

### Inventory-First, Runtime-First, Gate-First

1. Freeze the command-level inventory and parity targets
2. Freeze governance and SSoT
3. Build the executable registry and runtime spine
4. Extract host-authoritative semantics
5. Deliver Wave 1 full parity on top of the runtime
6. Record deferred-wave decisions
7. Prove Wave 1 parity and architecture shape with deterministic gates

### MVP Scope

The minimum valuable increment is:

1. one authoritative command-level inventory
2. one derived code mirror with drift tests
3. one executable Wave 1 registry aligned to the inventory
4. one `ModeParityRuntime`
5. shared host-dependent semantics
6. Wave 1 full parity
7. one command-level remote-first gate plus architecture guards
