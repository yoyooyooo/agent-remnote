# Tasks: 020-agent-cli-contract

**Input**: Design documents from `specs/020-agent-cli-contract/`  
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/cli.md`, `contracts/http-api.md`, `quickstart.md`

## Phase 1: Setup

- [x] T001 Create a shared apply-envelope entry module in `packages/agent-remnote/src/lib/hostApiUseCases.ts` and `packages/agent-remnote/src/commands/apply.ts`
- [x] T002 Add or update public-surface help contract tests in `packages/agent-remnote/tests/contract/cli-help.contract.test.ts`

## Phase 2: Foundational

- [x] T010 Consolidate structured actions and raw ops parsing under one canonical apply pipeline in `packages/agent-remnote/src/commands/apply.ts` and `packages/agent-remnote/src/commands/_writePlanCommand.ts`
- [x] T011 Extend the action compiler/registry for the new public action names in `packages/agent-remnote/src/kernel/write-plan/compile.ts`
- [x] T012 Collapse Host API write handling onto one route in `packages/agent-remnote/src/runtime/http-api/runHttpApiRuntime.ts` and `packages/agent-remnote/src/services/HostApiClient.ts`
- [x] T013 Remove public `plan apply` wiring from `packages/agent-remnote/src/commands/plan/index.ts` and `packages/agent-remnote/src/commands/index.ts`

## Phase 3: User Story 1 - Canonical Apply Contract

**Goal**: make `apply --payload` the only canonical machine write entry for both structured actions and raw ops.

**Independent Test**: `apply --payload` accepts `kind: "actions"` and `kind: "ops"` locally and through Host API, while removed JSON entrypoints fail fast.

- [x] T020 [US1] Implement the canonical apply envelope parser and validation in `packages/agent-remnote/src/commands/apply.ts`
- [x] T021 [P] [US1] Route Host API writes through the same apply envelope in `packages/agent-remnote/src/runtime/http-api/runHttpApiRuntime.ts`
- [x] T022 [P] [US1] Collapse Host API client methods into one write method in `packages/agent-remnote/src/services/HostApiClient.ts`
- [x] T023 [US1] Add CLI contract coverage for `kind: "actions"` and `kind: "ops"` in `packages/agent-remnote/tests/contract/apply-envelope.contract.test.ts`
- [x] T024 [P] [US1] Add HTTP contract coverage for the canonical write route in `packages/agent-remnote/tests/contract/http-api-write-apply.contract.test.ts`
- [x] T025 [US1] Remove old Host API route tests and replace them with canonical-route assertions in `packages/agent-remnote/tests/contract/http-api-write-apply.contract.test.ts`

## Phase 4: User Story 2 - Direct-Children Wrapper Commands

**Goal**: expose `rem children append/prepend/replace/clear` as thin wrappers over the canonical apply contract.

**Independent Test**: each `rem children` command compiles to the canonical write path, and `clear` remains distinct from `delete` and `set-text`.

- [x] T030 [US2] Add the `rem children` subcommand tree in `packages/agent-remnote/src/commands/rem/index.ts` and `packages/agent-remnote/src/commands/write/rem/index.ts`
- [x] T031 [P] [US2] Implement `append` and `prepend` wrappers in `packages/agent-remnote/src/commands/write/rem/children/append.ts` and `packages/agent-remnote/src/commands/write/rem/children/prepend.ts`
- [x] T032 [P] [US2] Implement `replace` and `clear` wrappers in `packages/agent-remnote/src/commands/write/rem/children/replace.ts` and `packages/agent-remnote/src/commands/write/rem/children/clear.ts`
- [x] T033 [US2] Implement or wire the direct-children replace/clear execution path in `packages/plugin/src/bridge/ops/handlers/markdownOps.ts` and `packages/agent-remnote/src/kernel/op-catalog/catalog.ts`
- [x] T034 [P] [US2] Add contract tests for `rem children` commands in `packages/agent-remnote/tests/contract/rem-children.contract.test.ts`
- [x] T035 [US2] Add fail-fast coverage distinguishing `rem children clear`, `rem delete`, and `rem set-text` in `packages/agent-remnote/tests/contract/rem-children.contract.test.ts`

## Phase 5: User Story 3 - Unified Markdown Input Contract

**Goal**: make `--markdown <input-spec>` the only public Markdown input shape for commands in scope.

**Independent Test**: Markdown-taking commands accept inline, `@file`, and `-`, while old content flags are removed from the public surface.

- [x] T040 [US3] Introduce a shared Markdown input-spec reader in `packages/agent-remnote/src/services/FileInput.ts` and a reusable command helper under `packages/agent-remnote/src/commands/_shared.ts`
- [x] T041 [P] [US3] Migrate `daily write` to the unified `--markdown <input-spec>` contract in `packages/agent-remnote/src/commands/daily/write.ts`
- [x] T042 [P] [US3] Remove stale Markdown flag branches from in-scope commands in `packages/agent-remnote/src/commands/import/markdown.ts` and `packages/agent-remnote/src/commands/write/md.ts`
- [x] T043 [US3] Update invalid-input hints that still mention `import markdown`, `--file`, `--stdin`, or `--md-file` in `packages/agent-remnote/src/commands/write/rem/create.ts` and related command files
- [x] T044 [P] [US3] Add contract tests for inline, `@file`, and `-` Markdown input in `packages/agent-remnote/tests/contract/markdown-input-spec.contract.test.ts`

## Phase 6: User Story 4 - Obsolete Surface Removal

**Goal**: remove superseded command and API surfaces in the same feature wave, with no compatibility residue.

**Independent Test**: obsolete commands and routes disappear from help/docs and fail fast when invoked.

- [x] T050 [US4] Delete the public `import` command group wiring in `packages/agent-remnote/src/commands/import/index.ts` and `packages/agent-remnote/src/commands/index.ts`
- [x] T051 [P] [US4] Delete WeChat command implementations in `packages/agent-remnote/src/commands/write/wechat/index.ts` and `packages/agent-remnote/src/commands/write/wechat/outline.ts`
- [x] T052 [P] [US4] Remove stale write-route methods and call sites in `packages/agent-remnote/src/services/HostApiClient.ts` and `packages/agent-remnote/src/commands/import/markdown.ts`
- [x] T053 [US4] Remove or merge stale duplicate Markdown command paths in `packages/agent-remnote/src/commands/write/md.ts` and related routing files
- [x] T054 [P] [US4] Add removed-command and removed-route fail-fast tests in `packages/agent-remnote/tests/contract/removed-write-surface.contract.test.ts`

## Phase 7: Polish & Cross-Cutting Sync

- [x] T060 Update SSoT write docs in `docs/ssot/agent-remnote/tools-write.md` and `docs/ssot/agent-remnote/http-api-contract.md`
- [x] T061 [P] Update public docs in `README.md`, `README.zh-CN.md`, and `README.local.md`
- [x] T062 [P] Update agent skill guidance in the local Codex RemNote skill doc (for example, `~/.codex/skills/remnote/SKILL.md`)
- [x] T063 Add or update end-to-end remote-mode smoke coverage in `packages/agent-remnote/tests/contract/http-api-write-apply.contract.test.ts`
- [x] T064 Run and record final verification evidence in `specs/020-agent-cli-contract/acceptance.md`
