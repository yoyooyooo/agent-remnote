# Acceptance: 024-agent-first-composite-writes

Date: 2026-03-19  
Spec: `specs/024-agent-first-composite-writes/spec.md`

## Result

- 状态：PASS
- `apply --payload` 已接受 canonical `portal.create`
- `parent_id` / `target_rem_id` 都支持 earlier `@alias`
- docs 与 skill 已把它定位为 atomic capability

## Evidence

- `tests/contract/write-plan.contract.test.ts`
- `tests/contract/api-write-apply.contract.test.ts`
- `docs/ssot/agent-remnote/tools-write.md`
- `README.md`
- `README.zh-CN.md`
- `README.local.md`
- `skills/remnote/SKILL.md`

## Real Integration Evidence

真实页：Daily Note `JicYxAq2RNdy9IoHy`（2026/03/19）

- 创建测试根：
  - `txn_id=9fdf3602-c4df-4463-9d46-3150cfbf0286`
  - `rem_id=KHBcPuAtCwbYVt1SM`
- 第一轮真实 `apply --payload --wait`：
  - `txn_id=0a88ca7d-d358-404f-ae0d-665c8564f924`
  - actions 包含两个 `write.bullet` + 一个 `portal.create`
  - earlier `@alias` 已真实驱动 `portal.create`
- 第二轮真实 `apply --payload --wait`：
  - `txn_id=284b34c0-87e1-48ee-bbb7-9f866e86fed7`
  - 在修正 `alias_map` 回显后再次验证
  - 返回 `alias_map.portal_parent_b -> tmp:...`
  - 同一响应中的 `id_map[].client_temp_id` 与该 `alias_map` 已能直接对齐
- 清理测试根：
  - `txn_id=1012e292-abeb-4dc9-a872-7275cbfeae0e`
  - 之后 `rem inspect --id KHBcPuAtCwbYVt1SM` 返回 not found

## Verification Commands

```bash
npm test --workspace agent-remnote -- --run tests/contract/write-plan.contract.test.ts tests/contract/api-write-apply.contract.test.ts
```
