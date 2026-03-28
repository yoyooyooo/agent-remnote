# Tasks: 033-fixed-runtime-owner

**Input**: Design documents from `/specs/033-fixed-runtime-owner/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/runtime-ownership.md`, `quickstart.md`

**Tests**: Included. This feature requires contract coverage for runtime-profile resolution, ownership metadata, doctor deterministic repairs, explicit takeover/reclaim, plus one lifecycle integration smoke.

**Organization**: Tasks are grouped by phase and user story so stable-owner safety, isolated dev defaults, explicit transfer, and observability can be delivered incrementally.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel
- **[Story]**: Which user story this task belongs to (`US1`, `US2`, `US3`, `US4`)
- Include exact file paths in descriptions

## Phase 1: Setup

- [ ] T001 Create runtime-profile resolution scaffolding in `packages/agent-remnote/tests/contract/runtime-owner-profile.contract.test.ts`
- [ ] T002 [P] Create ownership status scaffolding in `packages/agent-remnote/tests/contract/runtime-owner-status.contract.test.ts`
- [ ] T003 [P] Create doctor deterministic repair scaffolding in `packages/agent-remnote/tests/contract/runtime-owner-doctor.contract.test.ts`
- [ ] T004 [P] Create takeover/reclaim scaffolding in `packages/agent-remnote/tests/contract/runtime-owner-takeover.contract.test.ts`
- [ ] T004a [P] Create direct lifecycle claim-policy scaffolding in `packages/agent-remnote/tests/contract/runtime-owner-direct-start.contract.test.ts`
- [ ] T005 [P] Create lifecycle integration scaffolding in `packages/agent-remnote/tests/integration/runtime-owner-lifecycle.integration.test.ts`
- [ ] T006 [P] Add fixture helpers for runtime roots, claim files, and synthetic pid/state metadata under `packages/agent-remnote/tests/helpers/`

---

## Phase 2: Foundational Docs & Contract Freeze (Blocking Prerequisites)

**Purpose**: Freeze the ownership model before runtime changes start.

- [ ] T010 Upgrade `specs/033-fixed-runtime-owner/spec.md`, `specs/033-fixed-runtime-owner/plan.md`, `specs/033-fixed-runtime-owner/research.md`, `specs/033-fixed-runtime-owner/data-model.md`, `specs/033-fixed-runtime-owner/contracts/runtime-ownership.md`, `specs/033-fixed-runtime-owner/quickstart.md`, and `specs/033-fixed-runtime-owner/tasks.md` if implementation learning changes the plan
- [ ] T011 [P] Update feature-local notes in `specs/033-fixed-runtime-owner/notes/README.md`, `specs/033-fixed-runtime-owner/notes/entrypoints.md`, and `specs/033-fixed-runtime-owner/notes/questions.md`
- [ ] T012 [P] Amend global lifecycle and ownership SSoT in `docs/ssot/agent-remnote/cli-contract.md`, `docs/ssot/agent-remnote/http-api-contract.md`, and `docs/ssot/agent-remnote/README.md`
- [ ] T013 [P] Freeze migration semantics and control-plane wording in `specs/033-fixed-runtime-owner/plan.md` and `specs/033-fixed-runtime-owner/contracts/runtime-ownership.md`

**Checkpoint**: One explicit plan exists for runtime profile, fixed-owner claim, ownership metadata, doctor repair boundary, and takeover surface.

---

## Phase 3: User Story 2 - Runtime Root & Isolated Dev Foundation (Priority: P1)

**Goal**: Default source execution to an isolated dev profile without touching stable runtime artifacts.

**Independent Test**: Source-tree invocation resolves to isolated runtime roots and non-canonical default artifacts while published install remains stable.

- [ ] T020 [P] [US2] Add runtime profile and runtime root resolution helpers in `packages/agent-remnote/src/lib/runtime-ownership/profile.ts` and `packages/agent-remnote/src/lib/runtime-ownership/paths.ts`
- [ ] T021 [US2] Refactor `packages/agent-remnote/src/services/Config.ts` to resolve `control_plane_root`, `runtime_profile`, `runtime_root`, `install_source`, `repo_root`, `worktree_root`, and `port_class`
- [ ] T022 [P] [US2] Refactor default path helpers in `packages/agent-remnote/src/services/DaemonFiles.ts`, `packages/agent-remnote/src/services/ApiDaemonFiles.ts`, `packages/agent-remnote/src/services/PluginServerFiles.ts`, `packages/agent-remnote/src/services/StatusLineFile.ts`, and related config defaults to derive from runtime root
- [ ] T023 [US2] Add deterministic worktree-keyed isolated port derivation and config-print exposure in `packages/agent-remnote/src/services/Config.ts` and `packages/agent-remnote/src/commands/config/print.ts`
- [ ] T023a [US2] Define isolated dev bootstrap policy for shared control-plane config and workspace-binding seeding without copying queue/receipts in `packages/agent-remnote/src/lib/runtime-ownership/profile.ts` and related store helpers
- [ ] T024 [US2] Add contract tests proving source-tree defaults do not collide with stable defaults in `packages/agent-remnote/tests/contract/runtime-owner-profile.contract.test.ts`

**Checkpoint**: Source execution becomes isolated by default and `config print` explains why.

---

## Phase 4: Foundational Ownership Metadata & Trust (Blocking Prerequisites)

**Purpose**: Make live runtime artifacts durable enough for ownership diagnostics and safe repair.

- [ ] T030 [P] Add shared owner-descriptor helpers in `packages/agent-remnote/src/lib/runtime-ownership/ownerDescriptor.ts`
- [ ] T030a [P] Add launcher resolution helpers in `packages/agent-remnote/src/lib/runtime-ownership/launcher.ts`
- [ ] T031 [P] Extend daemon metadata types and persistence in `packages/agent-remnote/src/services/DaemonFiles.ts`, `packages/agent-remnote/src/runtime/supervisor/runSupervisorRuntime.ts`, and `packages/agent-remnote/src/commands/ws/_shared.ts`
- [ ] T032 [P] Extend API metadata types and persistence in `packages/agent-remnote/src/services/ApiDaemonFiles.ts`, `packages/agent-remnote/src/runtime/http-api/runHttpApiRuntime.ts`, and `packages/agent-remnote/src/commands/api/_shared.ts`
- [ ] T033 [P] Extend plugin metadata types and persistence in `packages/agent-remnote/src/services/PluginServerFiles.ts`, `packages/agent-remnote/src/runtime/plugin-static/runPluginStaticRuntime.ts`, and `packages/agent-remnote/src/commands/plugin/_shared.ts`
- [ ] T034 Add ownership-aware trust checks in `packages/agent-remnote/src/lib/pidTrust.ts`
- [ ] T035 Add serialization and trust contract tests in `packages/agent-remnote/tests/contract/runtime-owner-status.contract.test.ts` and updated pid-trust tests

**Checkpoint**: Live runtime artifacts can explain who owns them and whether they are trusted.

---

## Phase 5: User Story 1 - Stable Default Claim And Deterministic Repair (Priority: P1)

**Goal**: Make stable the default fixed owner and let doctor repair deterministic mismatches safely.

**Independent Test**: Canonical claim defaults to stable, stale or mismatched trusted owners are repaired toward the claim, and ambiguous owners are reported but not auto-killed.

- [ ] T040 [P] [US1] Add fixed-owner claim persistence and normalization in `packages/agent-remnote/src/lib/runtime-ownership/claim.ts`
- [ ] T041 [P] [US1] Add ownership conflict detection in `packages/agent-remnote/src/lib/runtime-ownership/conflictDetection.ts`
- [ ] T042 [US1] Update `packages/agent-remnote/src/lib/doctor/checks.ts` and `packages/agent-remnote/src/commands/doctor.ts` to expose claim/live ownership checks and repairability
- [ ] T043 [US1] Update `packages/agent-remnote/src/lib/doctor/fixes.ts` to repair deterministic ownership problems toward the canonical claim
- [ ] T044 [US1] Update `packages/agent-remnote/tests/contract/runtime-owner-doctor.contract.test.ts` to cover stale claim, deterministic mismatch, and ambiguous conflict cases

**Checkpoint**: Stable ownership is the default truth, and doctor can repair deterministic drift.

---

## Phase 6: User Story 4 - Ownership Observability Across Status Surfaces (Priority: P2)

**Goal**: Make ownership visible through stack/config/runtime status instead of hidden in logs.

**Independent Test**: `stack status`, `daemon status`, `api status`, `plugin status`, and `config print` expose claim/live owner consistently.

- [ ] T050 [P] [US4] Update `packages/agent-remnote/src/commands/stack/status.ts` to include fixed-owner claim, resolved local profile, live owner, effective endpoints, conflict summary, repair strategy, and warnings
- [ ] T051 [P] [US4] Update `packages/agent-remnote/src/commands/ws/status.ts`, `packages/agent-remnote/src/commands/api/status.ts`, and `packages/agent-remnote/src/commands/plugin/status.ts` to surface owner metadata
- [ ] T052 [US4] Update `packages/agent-remnote/src/commands/config/print.ts` to show runtime profile/root/claim/default artifact paths
- [ ] T053 [US4] Add contract coverage for status/config output in `packages/agent-remnote/tests/contract/runtime-owner-status.contract.test.ts`

**Checkpoint**: Ownership is visible and comparable across all lifecycle surfaces.

---

## Phase 7: User Story 3 - Explicit Takeover / Reclaim Flow (Priority: P2)

**Goal**: Let the maintainer intentionally transfer the fixed URL between stable and dev without changing the URL itself.

**Independent Test**: A dev takeover and stable reclaim can run from trusted metadata, update the claim, and report reload requirements explicitly.

- [ ] T060 [P] [US3] Add lifecycle policy helpers for canonical-owner transfer in `packages/agent-remnote/src/lib/runtime-ownership/claim.ts`, `packages/agent-remnote/src/lib/runtime-ownership/launcher.ts`, and related stack helpers
- [ ] T061 [US3] Add `packages/agent-remnote/src/commands/stack/takeover.ts` and register it under `packages/agent-remnote/src/commands/stack/index.ts`
- [ ] T062 [US3] Update `packages/agent-remnote/src/commands/stack/ensure.ts`, `packages/agent-remnote/src/commands/stack/stop.ts`, and runtime start/ensure helpers to respect canonical claim ownership for daemon + api + plugin
- [ ] T062a [US3] Add plugin artifact preflight for `stack takeover --channel dev` in `packages/agent-remnote/src/commands/stack/takeover.ts` and related plugin helpers
- [ ] T062b [US3] Add direct canonical-port guard tests for `daemon/api/plugin start|ensure` in `packages/agent-remnote/tests/contract/runtime-owner-direct-start.contract.test.ts`
- [ ] T063 [US3] Add transfer result fields including `remnote_reload_required`, restart summary, and next actions
- [ ] T064 [US3] Add contract tests for stable -> dev takeover and dev -> stable reclaim in `packages/agent-remnote/tests/contract/runtime-owner-takeover.contract.test.ts`
- [ ] T065 [US3] Add one lifecycle integration smoke in `packages/agent-remnote/tests/integration/runtime-owner-lifecycle.integration.test.ts`
- [ ] T066 [US3] Add one packed-install + source-tree coexistence integration using `packages/agent-remnote/tests/helpers/packedCli.ts`

**Checkpoint**: Fixed-owner transfer becomes explicit, deterministic, and observable.

---

## Phase 8: Docs, Runbooks, And Agent Guidance

- [ ] T070 [P] Update `README.md`, `README.zh-CN.md`, `README.local.md` (create if absent), and `packages/agent-remnote/README.md` with stable-owner default, isolated dev default, and takeover workflow
- [ ] T071 [P] Update `AGENTS.md` with runtime-owner and local-debug guidance for future agents
- [ ] T072 [P] Update `skills/remnote/SKILL.md` to route lifecycle troubleshooting through the ownership model
- [ ] T073 Sync final ownership contract wording back into `docs/ssot/agent-remnote/cli-contract.md`, `docs/ssot/agent-remnote/http-api-contract.md`, `docs/ssot/agent-remnote/ui-context-and-persistence.md`, and `docs/ssot/agent-remnote/README.md`

---

## Phase 9: Polish & Verification

- [ ] T080 [P] Run targeted package tests for ownership contract suites with `npm test --workspace agent-remnote -- <paths>`
- [ ] T081 Run `npm run typecheck --workspace agent-remnote`
- [ ] T082 Run `npm test --workspace agent-remnote`
- [ ] T083 Perform the manual host smoke described in `specs/033-fixed-runtime-owner/quickstart.md`
- [ ] T084 Verify docs/skill/SSoT drift is closed for ownership terminology and command surface, including `README.local.md`

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Docs & Contract Freeze (Phase 2)**: Depends on Setup and blocks major implementation changes
- **US2 Runtime Root/Foundation (Phase 3)**: Depends on Phase 2
- **Ownership Metadata & Trust (Phase 4)**: Depends on Phase 3 and blocks doctor/status/transfer work
- **US1 Deterministic Repair (Phase 5)**: Depends on Phase 4
- **US4 Observability (Phase 6)**: Depends on Phase 4 and can proceed in parallel with Phase 5 after claim/conflict primitives exist
- **US3 Takeover/Reclaim (Phase 7)**: Depends on Phases 4-6
- **Docs & Guidance (Phase 8)**: Depends on stabilized behavior from Phases 5-7
- **Polish (Phase 9)**: Depends on all desired stories being complete

### Parallel Opportunities

- Setup contract scaffolding tasks marked `[P]` can run in parallel
- Runtime-root path refactors across daemon/api/plugin file services can run in parallel once the shared profile/root helpers exist
- Ownership metadata extensions across daemon/api/plugin can run in parallel after the owner descriptor schema freezes
- Status surface updates can run in parallel once claim/conflict primitives exist

## Implementation Strategy

### Claim-First Lifecycle Governance

1. Freeze the ownership contract
2. Make runtime roots/profile resolution authoritative
3. Attach durable owner metadata to live artifacts
4. Add the canonical fixed-owner claim
5. Teach doctor/status to reason from claim plus live metadata
6. Add explicit transfer
7. Close docs and verification

### MVP Scope

The minimum valuable increment is:

1. stable default claim
2. isolated source defaults
3. ownership metadata in runtime artifacts
4. doctor/status ownership visibility
5. one explicit takeover command
