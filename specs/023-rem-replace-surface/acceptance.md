# Acceptance: 023-rem-replace-surface

Date: 2026-03-19  
Spec: `specs/023-rem-replace-surface/spec.md`

## Result

- 状态：PASS
- 规范化 `rem replace` 已成为公开 replace family
- `rem children replace` 保留为兼容包装器
- `replace markdown` 已明确降级为 advanced/local-only

## Automated Evidence

- `tests/contract/rem-replace.contract.test.ts`
- `tests/contract/help.contract.test.ts`
- `tests/contract/replace-block.contract.test.ts`
- `tests/contract/invalid-options.contract.test.ts`
- full suite: `npm test --workspace agent-remnote`

## Coverage

| Area | Result | Evidence |
| --- | --- | --- |
| Canonical `rem replace` surface | PASS | `write/rem/replace.ts` + `rem-replace.contract.test.ts` |
| `--surface children\|self` routing | PASS | `compile.ts` + `rem-replace.contract.test.ts` |
| Repeated `--rem` and `--selection` selectors | PASS | `rem-replace.contract.test.ts` |
| Invalid combinations fail fast | PASS | `rem-replace.contract.test.ts` + `invalid-options.contract.test.ts` |
| Legacy/advanced demotion messaging | PASS | `replace-block.contract.test.ts` + help output |
| Docs and command tree positioning | PASS | `README.md`, `README.zh-CN.md`, `README.local.md`, `docs/ssot/agent-remnote/tools-write.md`, `docs/ssot/agent-remnote/cli-contract.md` |

## Verification Commands

```bash
npm test --workspace agent-remnote -- --run tests/contract/rem-replace.contract.test.ts tests/contract/help.contract.test.ts tests/contract/replace-block.contract.test.ts tests/contract/invalid-options.contract.test.ts
npm test --workspace agent-remnote
```
