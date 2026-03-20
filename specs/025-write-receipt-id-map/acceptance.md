# Acceptance: 025-write-receipt-id-map

Date: 2026-03-19  
Spec: `specs/025-write-receipt-id-map/spec.md`

## Result

- 状态：PASS
- wait-mode 成功回执统一暴露 canonical `id_map`
- local / remote `apply --wait` 语义一致
- `rem_id` / `portal_rem_id` 保留为 derived sugar

## Evidence

- `tests/contract/write-wait.contract.test.ts`
- `tests/contract/api-write-apply.contract.test.ts`
- `tests/contract/queue-wait-remote-api.contract.test.ts`
- `tests/contract/ids-output.contract.test.ts`
- `README.md`
- `README.zh-CN.md`
- `docs/ssot/agent-remnote/http-api-contract.md`
- `docs/ssot/agent-remnote/tools-write.md`
- `skills/remnote/SKILL.md`

## Real Integration Evidence

真实页：Daily Note `<REDACTED_NOTE_ID>`（2026/03/19）

- `rem create --wait`
  - `txn_id=<REDACTED_TXN_CREATE>`
  - 回执直接包含 `id_map`
  - `rem_id=<REDACTED_REM_ID>` 与 `id_map[0].remote_id` 一致
- 第一轮真实 `apply --payload --wait`
  - `txn_id=<REDACTED_TXN_APPLY_A>`
  - 通过 `queue inspect` 发现一个真实缺口：对外返回的 `alias_map` 与真实入队 payload 的 `client_temp_id` 不是同一组值，导致 `alias_map + id_map` 不能直接拼接
- 修复后第二轮真实 `apply --payload --wait`
  - `txn_id=<REDACTED_TXN_APPLY_B>`
  - `alias_map.<ALIAS_PARENT> = <CLIENT_TEMP_ID_0>`
  - `id_map[0].client_temp_id = <CLIENT_TEMP_ID_0>`
  - `alias_map.<ALIAS_TARGET> = <CLIENT_TEMP_ID_1>`
  - `id_map[1].client_temp_id = <CLIENT_TEMP_ID_1>`
  - 说明 agent 可直接用 `alias_map + id_map` 做 continuation

## Verification Commands

```bash
npm test --workspace agent-remnote -- --run tests/contract/write-wait.contract.test.ts tests/contract/api-write-apply.contract.test.ts tests/contract/queue-wait-remote-api.contract.test.ts tests/contract/ids-output.contract.test.ts
```
