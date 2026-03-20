# Acceptance: 026-recent-activity-summaries

Date: 2026-03-19  
Spec: `specs/026-recent-activity-summaries/spec.md`

## Result

- 状态：PASS
- `db recent` 已升级为 normalized query primitive
- 顶层 schema 固定为 `counts + items + aggregates`
- 支持 `--kind`、`--aggregate`、`--timezone`、`--item-limit`、`--aggregate-limit`
- remote `apiBaseUrl` 模式下保持 strict fail-fast

## Evidence

- `tests/contract/db-recent.contract.test.ts`
- `tests/contract/remote-mode-local-read-guard.contract.test.ts`
- `src/internal/remdb-tools/summarizeRecentActivity.ts`
- `src/commands/read/db/recent.ts`
- `README.md`
- `README.zh-CN.md`
- `README.local.md`

## Verification Commands

```bash
npm test --workspace agent-remnote -- --run tests/contract/db-recent.contract.test.ts tests/contract/remote-mode-local-read-guard.contract.test.ts
```
