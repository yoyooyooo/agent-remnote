# Acceptance Evidence: 020-agent-cli-contract

Date: 2026-03-11  
Spec: `specs/020-agent-cli-contract/spec.md`

## Result

- `020-agent-cli-contract` is implemented and verified.
- Public write surface is now centered on:
  - `apply --payload`
  - `rem children append/prepend/replace/clear`
  - `daily write --markdown|--text`
- Old public surfaces were removed in the same wave:
  - `import`
  - `import markdown`
  - `import wechat outline`
  - `plan apply`
  - `POST /v1/write/markdown`
  - `POST /v1/write/ops`

## Automated Evidence

### Typecheck

```bash
npm run typecheck --workspace agent-remnote
```

Result: PASS

### Lint

```bash
npm run lint --workspace agent-remnote
```

Result: PASS with pre-existing warnings outside this feature's scope; no lint errors.

### Full Test Suite

```bash
npm test --workspace agent-remnote
```

Result:

- Test Files: `99 passed`
- Tests: `224 passed`

## Real DN Integration Smoke

Environment:

- Host runtime healthy
- Active worker connected after plugin restart
- Target Daily Note rem id: `4MZL7Gxd3MIwn3M9J`

### Verified local CLI write paths

- `rem create`
- `rem set-text`
- `rem delete`
- `rem children append`
- `rem children prepend`
- `rem children replace`
- `rem children clear`
- `daily write --markdown`
- `daily write --text`

### Verified canonical apply paths

- `apply --payload` with `kind:"actions"`
- `apply --payload` with `kind:"ops"`
- `apply --wait --timeout-ms --poll-ms`

### Verified Host API / remote mode paths

- `--api-base-url ... rem children append`
- `--api-base-url ... rem children clear`
- `--api-base-url ... daily write --markdown`
- `POST /v1/write/apply`
- `queue wait` through remote mode

### Real write outcomes

Observed successful transactions included:

- `cf4e0f10-5a40-44fa-af13-50b0986dae4b` (`rem create`)
- `0e88dc09-568b-4641-b8e7-a4489d4db7f8` (`rem children append`)
- `e2ba0408-529f-4d67-8899-073f5fabed5d` (`rem children prepend`)
- `37385947-d84e-4537-9f53-de03fd922a98` (`rem children replace`)
- `e73247a7-301a-4a9e-823f-82e833dd6b92` (`rem children clear` via remote mode)
- `17f2e4d2-5c40-4494-91c3-002ae3a05666` (`apply` actions + `queue wait`)
- `b5d55780-60b2-4587-b35e-ffd9374ad265` (`apply` ops + `queue wait`)
- `e1a0481e-899c-43e8-9c94-c1de2a245444` (`apply --wait`)
- `0b3161ea-7924-4e32-a248-5dfb67b6d370` (direct HTTP `POST /v1/write/apply`)

### Real read-back checks

- `rem outline` confirmed `replace` changed only direct children under the target Rem.
- `rem outline` confirmed `clear` left the target Rem in place and removed its direct children.
- `search` confirmed the timestamped integration markers were present when expected.

### Cleanup

All timestamped integration artifacts written into the Daily Note were deleted after verification.

Post-cleanup checks:

```bash
agent-remnote --json search --query "20260311-215121" --limit 20
agent-remnote --json search --query "20260311-220818" --limit 20
```

Result: both returned `count: 0`.

## FR Coverage

| ID | Result | Evidence |
| --- | --- | --- |
| FR-001 to FR-004 | PASS | `apply.ts`, apply envelope contract tests, full suite |
| FR-005 to FR-010 | PASS | `rem children/*`, `daily/write.ts`, direct CLI smoke, contract tests |
| FR-011 to FR-015 | PASS | removed command wiring, help tests, grep over docs/code |
| FR-016 to FR-020 | PASS | `runHttpApiRuntime.ts`, `HostApiClient.ts`, remote-mode smoke, HTTP contract tests |

## SC Coverage

| ID | Result | Evidence |
| --- | --- | --- |
| SC-001 | PASS | root help no longer exposes `import` or `plan`; full contract suite |
| SC-002 | PASS | `rem children` help + dry-run + real DN smoke |
| SC-003 | PASS | `daily-write-trim.contract.test.ts`, `help.contract.test.ts` |
| SC-004 | PASS | `write-plan.contract.test.ts`, `write-ops.contract.test.ts`, real `apply` smoke |
| SC-005 | PASS | repo-wide grep + removed command routing + cleanup of old docs |
| SC-006 | PASS | `http-api-contract.md`, `api-write-markdown.contract.test.ts`, real `POST /v1/write/apply` smoke |

## Notes

- The legacy test filename `tests/contract/api-write-markdown.contract.test.ts` still exists, but its assertions now target `/v1/write/apply`.
- The feature intentionally keeps the legacy `--queue-db` flag alias because that behavior belongs to earlier storage compatibility policy, not to the removed write-surface contract.
