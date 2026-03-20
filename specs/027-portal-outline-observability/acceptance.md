# Acceptance: 027-portal-outline-observability

Date: 2026-03-19  
Spec: `specs/027-portal-outline-observability/spec.md`

## Result

- 状态：PASS
- local outline JSON 节点已显式暴露 `kind`
- portal 节点已显式暴露 `target.{id,text,resolved}`
- unresolved target 有稳定标记
- remote outline contract 与 local typed-node 语义对齐

## Evidence

- `tests/contract/outline-portal.contract.test.ts`
- `tests/contract/outline-remote-api.contract.test.ts`
- `tests/contract/outline-hidden-backup.contract.test.ts`
- `src/internal/remdb-tools/outlineRemSubtree.ts`
- `src/lib/hostApiUseCases.ts`
- `README.md`
- `README.zh-CN.md`
- `README.local.md`
- `skills/remnote/SKILL.md`

## Real Integration Evidence

真实页：Daily Note `JicYxAq2RNdy9IoHy`（2026/03/19）

- 真实 `portal.create` 写入后，第一次 `rem outline --format json --detail` 只看到了一个空节点，没有识别成 `portal`
- 随后用真实 `rem inspect --id 6w6dJ6r3D92IDN2Zx` 抓到 portal 容器的底层 doc：
  - `type: 6`
  - `pd: { "m3NU93mU3rGPjCchB": { "d": true, ... } }`
- 这说明真实 portal 在本地 DB 中的稳定识别信号是 `doc.type=6 + doc.pd`，而不只是测试夹具里的 token 形态
- 修复后再次真实回读：
  - `rem outline --id KHBcPuAtCwbYVt1SM --depth 6 --format json --detail --include-empty`
  - portal 节点 `6w6dJ6r3D92IDN2Zx` 现在返回：
    - `kind: "portal"`
    - `text: "Portal -> portal-target 20260319-223952"`
    - `target.id: "m3NU93mU3rGPjCchB"`
    - `target.text: "portal-target 20260319-223952"`
    - `target.resolved: true`

## Verification Commands

```bash
npm test --workspace agent-remnote -- --run tests/contract/outline-portal.contract.test.ts tests/contract/outline-remote-api.contract.test.ts tests/contract/outline-hidden-backup.contract.test.ts
```
