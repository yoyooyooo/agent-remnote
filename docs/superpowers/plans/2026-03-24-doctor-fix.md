# Doctor Fix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `doctor --fix`, repair packaged builtin-scenarios resolution, fix `search --json` stdout pollution, and ship the matching tests and docs.

**Architecture:** Keep `doctor` as the single diagnostics surface, move checks/fixes into reusable library modules, and execute safe repairs through existing lifecycle services. Package-layout detection and JSON-output guarantees are implemented as focused fixes with dedicated contract coverage.

**Tech Stack:** TypeScript, Effect, @effect/cli, Vitest, better-sqlite3

---

## Chunk 1: Planning And Contracts

### Task 1: Add design and feature-spec artifacts

**Files:**
- Create: `docs/superpowers/specs/2026-03-24-doctor-fix-design.md`
- Create: `docs/superpowers/plans/2026-03-24-doctor-fix.md`
- Create: `specs/032-doctor-fix-and-runtime-self-heal/spec.md`
- Create: `specs/032-doctor-fix-and-runtime-self-heal/plan.md`
- Create: `specs/032-doctor-fix-and-runtime-self-heal/tasks.md`
- Create: `specs/032-doctor-fix-and-runtime-self-heal/acceptance.md`
- Create: `specs/032-doctor-fix-and-runtime-self-heal/quickstart.md`
- Create: `specs/032-doctor-fix-and-runtime-self-heal/meta.yaml`

- [ ] Write the feature design/spec artifacts
- [ ] Re-read for scope drift and missing boundaries

### Task 2: Add failing contract coverage

**Files:**
- Create: `packages/agent-remnote/tests/contract/doctor-fix.contract.test.ts`
- Create: `packages/agent-remnote/tests/contract/builtin-scenario-installed-layout.contract.test.ts`
- Create: `packages/agent-remnote/tests/contract/search-json-output.contract.test.ts`
- Modify: `packages/agent-remnote/tests/contract/doctor-schema.contract.test.ts`
- Modify: `packages/agent-remnote/tests/unit/config-user-config.unit.test.ts`

- [ ] Write failing tests for `doctor --fix` structured output and safe repair flow
- [ ] Write failing tests for builtin-scenarios resolution under installed layout
- [ ] Write failing tests for `search --json` stdout purity
- [ ] Run targeted tests and verify RED

## Chunk 2: Runtime And Packaging Fixes

### Task 3: Extract doctor runtime and repair library

**Files:**
- Create: `packages/agent-remnote/src/lib/doctor/types.ts`
- Create: `packages/agent-remnote/src/lib/doctor/checks.ts`
- Create: `packages/agent-remnote/src/lib/doctor/fixes.ts`
- Modify: `packages/agent-remnote/src/commands/doctor.ts`

- [ ] Add typed doctor check/fix models
- [ ] Implement read-only checks for the first 6 stable ids
- [ ] Implement safe repair pipeline for stale pid/state cleanup and restart-summary reporting (no automatic restart)
- [ ] Implement doctor command rendering for diagnostics-only and fix mode
- [ ] Run targeted doctor tests and verify GREEN

### Task 4: Fix packaged builtin-scenarios path resolution

**Files:**
- Modify: `packages/agent-remnote/src/lib/builtin-scenarios/index.ts`

- [ ] Add installed-layout aware resolution logic
- [ ] Keep source checkout behavior intact
- [ ] Run builtin-scenario contract tests and verify GREEN

### Task 5: Fix `search --json` output pollution

**Files:**
- Modify: `packages/agent-remnote/src/main.ts`
- Modify: `packages/agent-remnote/src/commands/read/search.ts`
- Modify: `packages/agent-remnote/tests/helpers/runCli.ts` if needed only for deterministic capture

- [ ] Isolate the actual cause of help text on stdout
- [ ] Implement the smallest fix that preserves normal help behavior
- [ ] Run search JSON contract tests and verify GREEN

## Chunk 3: Config Migration And Docs

### Task 6: Add config normalization/migration helpers

**Files:**
- Modify: `packages/agent-remnote/src/services/UserConfigFile.ts`
- Modify: `packages/agent-remnote/src/services/Config.ts`
- Modify: `packages/agent-remnote/tests/unit/config-user-config.unit.test.ts`

- [ ] Add reusable config canonicalization for doctor repair
- [ ] Preserve supported user values while rewriting only known canonical keys
- [ ] Run config unit tests and verify GREEN

### Task 7: Sync docs and contracts

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.local.md`
- Modify: `docs/ssot/agent-remnote/cli-contract.md`

- [ ] Document `doctor --fix` behavior and boundaries
- [ ] Document packaged integrity and JSON-output guarantees
- [ ] Ensure docs match the final CLI behavior

## Chunk 4: Verification And Review Loop

### Task 8: Full verification

**Files:**
- No code changes required unless failures appear

- [ ] Run targeted tests for all new coverage
- [ ] Run `npm test --workspace agent-remnote`
- [ ] Fix any regressions

### Task 9: Five-reviewer evaluation loop

**Files:**
- No fixed write set; may touch implementation/docs/tests based on review

- [ ] Spawn 5 reviewer subagents with disjoint review lenses
- [ ] Aggregate findings
- [ ] Apply fixes
- [ ] Re-run verification
- [ ] Repeat review loop until all 5 reviewers approve
