# Tasks: 023-rem-replace-surface

**Input**: Design documents from `/specs/023-rem-replace-surface/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/cli.md`, `quickstart.md`

**Tests**: Included. This feature changes the public CLI contract, and the repository quality gates require local contract coverage for CLI surface changes.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel
- **[Story]**: User story label (`US1`, `US2`, `US3`)
- Every task includes exact file paths

## Phase 1: Setup

**Purpose**: Create the canonical implementation and test entry points for the new replace family.

- [ ] T001 Create the canonical command module scaffold in `packages/agent-remnote/src/commands/write/rem/replace.ts`
- [ ] T002 [P] Create the feature-specific contract test scaffold in `packages/agent-remnote/tests/contract/rem-replace.contract.test.ts`

---

## Phase 2: Foundational

**Purpose**: Establish shared wiring and validation hooks that all user stories depend on.

**⚠️ CRITICAL**: No user story work should start until this phase is complete.

- [ ] T010 Add shared target-selector and surface-validation helpers in `packages/agent-remnote/src/commands/write/rem/replace.ts` and `packages/agent-remnote/src/commands/write/rem/children/common.ts`
- [ ] T011 [P] Register the canonical `rem replace` entry under the public `rem` command in `packages/agent-remnote/src/commands/rem/index.ts`
- [ ] T012 [P] Prepare legacy and advanced replace surfaces for demotion messaging in `packages/agent-remnote/src/commands/write/rem/children/replace.ts` and `packages/agent-remnote/src/commands/write/replace/block.ts`

**Checkpoint**: Canonical `rem replace` has a wired entry point and shared validation base.

---

## Phase 3: User Story 1 - One Canonical Replace Family (Priority: P1) 🎯 MVP

**Goal**: Make `rem replace` the one canonical public family for both children rewrite and self replacement.

**Independent Test**: A caller can express both "replace this Rem's children" and "replace these Rems in place" through `rem replace`, and help output presents it as the primary path.

- [ ] T020 [P] [US1] Add dry-run contract coverage for `rem replace --surface children` and `rem replace --surface self` in `packages/agent-remnote/tests/contract/rem-replace.contract.test.ts`
- [ ] T021 [P] [US1] Add canonical help-surface assertions for `rem replace` in `packages/agent-remnote/tests/contract/help.contract.test.ts`
- [ ] T022 [US1] Implement canonical `rem replace` command parsing and output handling in `packages/agent-remnote/src/commands/write/rem/replace.ts`
- [ ] T023 [US1] Route `--surface children` and `--surface self` to the existing replace primitives in `packages/agent-remnote/src/commands/write/rem/replace.ts` and `packages/agent-remnote/src/kernel/write-plan/compile.ts`
- [ ] T024 [US1] Keep the top-level command tree aligned with the new canonical entry in `packages/agent-remnote/src/commands/rem/index.ts` and `packages/agent-remnote/src/commands/index.ts`

**Checkpoint**: `rem replace` is the primary documented and executable replace family.

---

## Phase 4: User Story 2 - Target Selection Stays a Parameter (Priority: P1)

**Goal**: Keep `selection` and repeated `--rem` as target selectors inside the canonical `rem replace` family.

**Independent Test**: Repeated `--rem` and `--selection` both work as selectors for `rem replace`, and canonical docs no longer promote a selection-named replace command.

- [ ] T030 [US2] Add contract coverage for repeated `--rem` targets and `--selection` target resolution in `packages/agent-remnote/tests/contract/rem-replace.contract.test.ts`
- [ ] T031 [US2] Implement repeated `--rem` parsing, selector exclusivity, and resolved target-set normalization in `packages/agent-remnote/src/commands/write/rem/replace.ts`
- [ ] T032 [US2] Reuse Host API-backed selection resolution for canonical replace in `packages/agent-remnote/src/commands/write/rem/replace.ts` and `packages/agent-remnote/src/commands/write/rem/children/common.ts`
- [ ] T033 [US2] Update canonical write-surface docs to present target selection as parameters in `docs/ssot/agent-remnote/tools-write.md` and `docs/ssot/agent-remnote/cli-contract.md`
- [ ] T034 [P] [US2] Update public docs and skill recipes for `rem replace` in `README.md`, `README.zh-CN.md`, `README.local.md`, and `~/.codex/skills/remnote/SKILL.md`

**Checkpoint**: Target selection is parameterized across CLI, docs, and skill guidance.

---

## Phase 5: User Story 3 - Invalid Combinations Fail Fast (Priority: P2)

**Goal**: Reject incompatible target/surface/assertion combinations deterministically before dispatch.

**Independent Test**: Invalid combinations return stable CLI failures for target count, shared parent, contiguity, and assertion gating.

- [ ] T040 [P] [US3] Add invalid-combination contract coverage in `packages/agent-remnote/tests/contract/rem-replace.contract.test.ts` and `packages/agent-remnote/tests/contract/invalid-options.contract.test.ts`
- [ ] T041 [US3] Enforce `--surface children` single-target validation and `preserve-anchor` gating in `packages/agent-remnote/src/commands/write/rem/replace.ts`
- [ ] T042 [US3] Enforce default same-parent and contiguous validation for `--surface self` in `packages/agent-remnote/src/commands/write/rem/replace.ts` and `packages/agent-remnote/src/commands/write/replace/_target.ts`
- [ ] T043 [US3] Normalize stable fail-fast messages across canonical and legacy surfaces in `packages/agent-remnote/src/commands/write/rem/replace.ts`, `packages/agent-remnote/src/commands/write/rem/children/replace.ts`, and `packages/agent-remnote/src/commands/write/replace/block.ts`
- [ ] T044 [US3] Update remote-mode and fail-fast contract wording in `docs/ssot/agent-remnote/http-api-contract.md` and `specs/023-rem-replace-surface/contracts/cli.md`

**Checkpoint**: Invalid combinations fail fast with one stable vocabulary across canonical and legacy paths.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Complete migration positioning, verification, and acceptance evidence.

- [ ] T050 [P] Remove stale first-choice replace recipes from help and docs in `packages/agent-remnote/tests/contract/help.contract.test.ts` and `docs/ssot/agent-remnote/tools-write.md`
- [ ] T051 [P] Update and extend manual verification steps in `specs/023-rem-replace-surface/quickstart.md`
- [ ] T052 Create acceptance evidence notes in `specs/023-rem-replace-surface/acceptance.md`
- [ ] T053 Run the relevant CLI contract suites and record the final pass set in `specs/023-rem-replace-surface/acceptance.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: starts immediately
- **Foundational (Phase 2)**: depends on Setup and blocks all user stories
- **User Story phases (Phase 3-5)**: depend on Foundational completion
- **Polish (Phase 6)**: depends on the desired user stories being complete

### User Story Dependencies

- **US1**: starts first and defines the canonical command family
- **US2**: depends on US1 command existence, then extends selector semantics and docs
- **US3**: depends on US1/US2 surface and selector behavior, then hardens validation and fail-fast rules

### Within Each User Story

- Contract tests should be added before or alongside implementation and must fail before the feature work is considered complete
- Command parsing and routing must exist before docs can be finalized
- Fail-fast wording should be normalized after validation behavior is implemented

## Parallel Opportunities

- `T002` can run in parallel with `T001`
- `T011` and `T012` can run in parallel after `T010`
- `T020` and `T021` can run in parallel within US1
- `T034` can run in parallel with `T033`
- `T040` can run in parallel with documentation prep in `T044`
- `T050` and `T051` can run in parallel in the polish phase

## Parallel Example: User Story 1

```bash
# Parallel contract coverage for the canonical surface
Task: "Add dry-run contract coverage for rem replace --surface children|self in packages/agent-remnote/tests/contract/rem-replace.contract.test.ts"
Task: "Add canonical help-surface assertions for rem replace in packages/agent-remnote/tests/contract/help.contract.test.ts"
```

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2
2. Complete Phase 3 (US1)
3. Validate `rem replace` as the canonical family before expanding selector and fail-fast hardening

### Incremental Delivery

1. Ship canonical command family under US1
2. Add selector unification and docs under US2
3. Add strict fail-fast guarantees under US3
4. Finish migration messaging and acceptance evidence in Phase 6

## Notes

- `rem children replace` and `replace markdown` stay in scope only as legacy or advanced surfaces
- This task list assumes no compatibility shim beyond documented migration positioning
- Final verification should include contract tests plus the manual paths captured in `quickstart.md`
