# Agent-First CLI Completion Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` for multi-worker execution when subagents are available, or `superpowers:executing-plans` for single-session plan execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining agent-first CLI specs so the public contract, remote parity, normalized read surfaces, and acceptance evidence converge on one coherent agent-oriented surface.

**Architecture:** This wave is executed from the shared contract layer outward. First stabilize shared apply and receipt primitives. Then finish the agent-facing write and read surfaces in specs 024-027. After that, complete the remaining Store/Host API tail work in specs 017 and 021. Finally reconcile the broad contract specs 020 and 023 against the implementation that already landed, filling only real gaps and backfilling acceptance evidence.

**Tech Stack:** TypeScript, Effect, `@effect/cli`, SQLite, Vitest, RemNote plugin bridge

---

## Chunk 1: Shared Contract Baseline

### Task 1: Freeze current implementation surface

**Files:**
- Modify: `packages/agent-remnote/tests/contract/write-plan.contract.test.ts`
- Modify: `packages/agent-remnote/tests/contract/api-write-apply.contract.test.ts`
- Modify: `packages/agent-remnote/tests/contract/write-wait.contract.test.ts`
- Modify: `packages/agent-remnote/tests/contract/queue-wait-remote-api.contract.test.ts`

- [ ] **Step 1: Add or extend failing contract coverage for portal actions and canonical receipts**
- [ ] **Step 2: Run targeted contract tests and confirm the new assertions fail for the right reasons**
Run: `npm test --workspace agent-remnote -- --run tests/contract/write-plan.contract.test.ts tests/contract/api-write-apply.contract.test.ts tests/contract/write-wait.contract.test.ts tests/contract/queue-wait-remote-api.contract.test.ts`
Expected: failing assertions around portal action compilation and `id_map` receipt shape before final implementation is complete
- [ ] **Step 3: Implement the minimal shared changes**
- [ ] **Step 4: Re-run the same targeted contract tests**
Expected: PASS

### Task 2: Consolidate to one canonical apply-and-wait receipt path

**Files:**
- Modify: `packages/agent-remnote/src/commands/_waitTxn.ts`
- Modify: `packages/agent-remnote/src/commands/apply.ts`
- Modify: `packages/agent-remnote/src/commands/_applyEnvelope.ts`
- Modify: `packages/agent-remnote/src/kernel/write-plan/compile.ts`
- Modify: `packages/agent-remnote/src/lib/hostApiUseCases.ts`
- Modify: `packages/agent-remnote/src/services/HostApiClient.ts`
- Modify: `packages/agent-remnote/src/runtime/http-api/runHttpApiRuntime.ts`

- [ ] **Step 1: Thread canonical `id_map` receipt data through local wait paths**
- [ ] **Step 2: Keep remote wait payloads aligned with the same receipt fields**
- [ ] **Step 3: Compile atomic portal actions through the canonical apply pipeline**
- [ ] **Step 4: Re-run the shared targeted contract suite**
Run: `npm test --workspace agent-remnote -- --run tests/contract/write-plan.contract.test.ts tests/contract/api-write-apply.contract.test.ts tests/contract/write-wait.contract.test.ts tests/contract/queue-wait-remote-api.contract.test.ts`
Expected: PASS

## Chunk 2: Specs 024-027

### Task 3: Finish spec 024 portal action parity

**Files:**
- Modify: `packages/agent-remnote/src/kernel/write-plan/compile.ts`
- Modify: `docs/ssot/agent-remnote/tools-write.md`
- Modify: `docs/ssot/agent-remnote/cli-contract.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.local.md`
- Modify: `specs/024-agent-first-composite-writes/tasks.md`

- [ ] **Step 1: Add failing docs/tests alignment checks if missing**
- [ ] **Step 2: Keep `portal.create` documented as an atomic action only**
- [ ] **Step 3: Re-run the spec-024 focused tests**
Run: `npm test --workspace agent-remnote -- --run tests/contract/write-plan.contract.test.ts tests/contract/api-write-apply.contract.test.ts`
Expected: PASS

### Task 4: Finish spec 025 canonical write receipts

**Files:**
- Modify: `packages/agent-remnote/src/commands/_waitTxn.ts`
- Modify: `packages/agent-remnote/src/commands/write/rem/create.ts`
- Modify: `packages/agent-remnote/src/commands/write/portal/create.ts`
- Modify: `packages/agent-remnote/tests/contract/ids-output.contract.test.ts`
- Modify: `specs/025-write-receipt-id-map/quickstart.md`
- Modify: `specs/025-write-receipt-id-map/tasks.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.local.md`

- [ ] **Step 1: Add failing consistency coverage between `id_map` and convenience ids**
- [ ] **Step 2: Keep convenience ids derived from the canonical mapping**
- [ ] **Step 3: Re-run the spec-025 focused tests**
Run: `npm test --workspace agent-remnote -- --run tests/contract/write-wait.contract.test.ts tests/contract/ids-output.contract.test.ts tests/contract/queue-wait-remote-api.contract.test.ts tests/contract/api-write-apply.contract.test.ts`
Expected: PASS

### Task 5: Finish spec 026 normalized recent activity

**Files:**
- Modify: `packages/agent-remnote/src/internal/remdb-tools/summarizeRecentActivity.ts`
- Modify: `packages/agent-remnote/src/commands/read/db/recent.ts`
- Modify: `packages/agent-remnote/tests/contract/db-recent.contract.test.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.local.md`
- Modify: `specs/026-recent-activity-summaries/tasks.md`

- [ ] **Step 1: Add failing contract coverage for normalized `items[]` and `aggregates[]`**
- [ ] **Step 2: Implement the normalized recent-activity helper and command shaping**
- [ ] **Step 3: Re-run the spec-026 focused tests**
Run: `npm test --workspace agent-remnote -- --run tests/contract/db-recent.contract.test.ts`
Expected: PASS

### Task 6: Finish spec 027 typed outline nodes

**Files:**
- Modify: `packages/agent-remnote/src/internal/remdb-tools/outlineRemSubtree.ts`
- Modify: `packages/agent-remnote/src/lib/hostApiUseCases.ts`
- Modify: `packages/agent-remnote/src/services/HostApiClient.ts`
- Modify: `packages/agent-remnote/tests/contract/outline-portal.contract.test.ts`
- Modify: `packages/agent-remnote/tests/contract/outline-remote-api.contract.test.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.local.md`
- Modify: `specs/027-portal-outline-observability/quickstart.md`
- Modify: `specs/027-portal-outline-observability/tasks.md`

- [ ] **Step 1: Add failing contract coverage for explicit node kinds and target metadata**
- [ ] **Step 2: Implement typed-node enrichment and remote parity**
- [ ] **Step 3: Re-run the spec-027 focused tests**
Run: `npm test --workspace agent-remnote -- --run tests/contract/outline-portal.contract.test.ts tests/contract/outline-remote-api.contract.test.ts`
Expected: PASS

## Chunk 3: Specs 017 and 021 Tail Work

### Task 7: Finish spec 017 Store automation skeleton

**Files:**
- Modify: `packages/agent-remnote/src/internal/store/schema.sql`
- Modify: `packages/agent-remnote/src/internal/store/db.ts`
- Create: `packages/agent-remnote/src/internal/store/automationDao.ts`
- Modify: `packages/agent-remnote/tests/contract/store-automation-skeleton.contract.test.ts`
- Modify: `specs/017-queue-db-generalize/tasks.md`
- Modify: `specs/017-queue-db-generalize/acceptance.md`

- [ ] **Step 1: Add failing contract coverage for automation skeleton tables and dedupe constraints**
- [ ] **Step 2: Implement the schema, migration hook, and minimal DAO**
- [ ] **Step 3: Re-run the spec-017 focused tests**
Run: `npm test --workspace agent-remnote -- --run tests/contract/store-automation-skeleton.contract.test.ts tests/contract/store-prefix-queue-tables.contract.test.ts tests/contract/store-legacy-queue-file-migration.contract.test.ts tests/contract/store-migrations-locking.contract.test.ts`
Expected: PASS

### Task 8: Finish spec 021 smoke and acceptance backfill

**Files:**
- Modify: `specs/021-host-api-remote-surface-and-workspace-binding/tasks.md`
- Modify: `specs/021-host-api-remote-surface-and-workspace-binding/acceptance.md`

- [ ] **Step 1: Re-run the relevant unit and contract tests for spec 021**
Run: `npm test --workspace agent-remnote -- --run tests/unit/workspace-bindings.unit.test.ts tests/contract/workspace-resolution.contract.test.ts tests/contract/api-status-capabilities.contract.test.ts tests/contract/api-lifecycle.contract.test.ts`
Expected: PASS
- [ ] **Step 2: Record remaining smoke evidence or explicit limitations in acceptance**

## Chunk 4: Specs 020 and 023 Reconciliation

### Task 9: Reconcile spec 023 with the landed rem replace surface

**Files:**
- Modify: `packages/agent-remnote/tests/contract/rem-replace.contract.test.ts`
- Modify: `packages/agent-remnote/tests/contract/help.contract.test.ts`
- Modify: `specs/023-rem-replace-surface/tasks.md`
- Create: `specs/023-rem-replace-surface/acceptance.md`
- Modify: `docs/ssot/agent-remnote/tools-write.md`
- Modify: `docs/ssot/agent-remnote/cli-contract.md`

- [ ] **Step 1: Compare current `rem replace` behavior with spec-023 requirements and add any missing failing tests**
- [ ] **Step 2: Implement only the real gaps**
- [ ] **Step 3: Re-run the spec-023 focused tests**
Run: `npm test --workspace agent-remnote -- --run tests/contract/rem-replace.contract.test.ts tests/contract/help.contract.test.ts tests/contract/invalid-options.contract.test.ts tests/contract/replace-block.contract.test.ts`
Expected: PASS

### Task 10: Reconcile spec 020 with the now-current agent-first CLI

**Files:**
- Modify: `packages/agent-remnote/src/commands/index.ts`
- Modify: `packages/agent-remnote/src/commands/plan/index.ts`
- Modify: `packages/agent-remnote/src/commands/import/index.ts`
- Modify: `packages/agent-remnote/src/commands/import/markdown.ts`
- Modify: `packages/agent-remnote/src/commands/write/md.ts`
- Modify: `packages/agent-remnote/src/commands/write/wechat/index.ts`
- Modify: `packages/agent-remnote/src/commands/write/wechat/outline.ts`
- Modify: `packages/agent-remnote/tests/contract/apply-envelope.contract.test.ts`
- Modify: `packages/agent-remnote/tests/contract/http-api-write-apply.contract.test.ts`
- Modify: `packages/agent-remnote/tests/contract/removed-write-surface.contract.test.ts`
- Modify: `specs/020-agent-cli-contract/tasks.md`
- Modify: `specs/020-agent-cli-contract/acceptance.md`

- [ ] **Step 1: Diff the current CLI tree against spec-020 requirements and write failing coverage for any missing removals or canonical paths**
- [ ] **Step 2: Remove or rewire any stale public surfaces that still violate the agent-first contract**
- [ ] **Step 3: Re-run the spec-020 focused tests**
Run: `npm test --workspace agent-remnote -- --run tests/contract/apply-envelope.contract.test.ts tests/contract/http-api-write-apply.contract.test.ts tests/contract/removed-write-surface.contract.test.ts tests/contract/help.contract.test.ts tests/contract/markdown-input-spec.contract.test.ts`
Expected: PASS

## Final Verification

### Task 11: Full verification and acceptance sync

**Files:**
- Modify: `specs/024-agent-first-composite-writes/tasks.md`
- Modify: `specs/025-write-receipt-id-map/tasks.md`
- Modify: `specs/026-recent-activity-summaries/tasks.md`
- Modify: `specs/027-portal-outline-observability/tasks.md`
- Modify: `specs/020-agent-cli-contract/acceptance.md`
- Modify: `specs/024-agent-first-composite-writes/acceptance.md`
- Modify: `specs/025-write-receipt-id-map/acceptance.md`
- Modify: `specs/026-recent-activity-summaries/acceptance.md`
- Modify: `specs/027-portal-outline-observability/acceptance.md`

- [ ] **Step 1: Run typecheck**
Run: `npm run typecheck --workspace agent-remnote`
Expected: PASS
- [ ] **Step 2: Run the full agent-remnote test suite**
Run: `npm test --workspace agent-remnote`
Expected: PASS
- [ ] **Step 3: Run plugin verification**  
Required when files under `packages/plugin/` changed in this wave.
Run: `npm run typecheck --workspace @remnote/plugin`
Expected: PASS
- [ ] **Step 4: Build the plugin**  
Required when files under `packages/plugin/` changed in this wave.
Run: `npm run build --workspace @remnote/plugin`
Expected: PASS
- [ ] **Step 5: Update task checklists and acceptance evidence with exact commands and outcomes**
