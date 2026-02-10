# Acceptance Report: 005-search-safety（上帝视角验收）

**Date**: 2026-01-26  
**Spec**: `specs/005-search-safety/spec.md`  
**Scope**: 覆盖 `spec.md` 内所有编码点：SC / FR / NFR  

## 总结裁决

- **整体结论**：通过（PASS）。read-rpc（SearchRequest/SearchResponse）已形成可验证基线；插件侧候选集搜索默认 3s/Top‑20（clamp）并返回 snippet；后端 DB 搜索提供硬超时隔离与可诊断回退；失败路径返回建议型 nextActions。

## 证据索引（高信号）

- WS read-rpc 契约：`specs/005-search-safety/contracts/ws-read-rpc.md`
- CLI 契约：`specs/005-search-safety/contracts/cli.md`
- CLI contract tests：
  - `packages/agent-remnote/tests/contract/read-search-plugin.contract.test.ts`
  - `packages/agent-remnote/tests/contract/read-search.contract.test.ts`
- 相关实现锚点：
  - CLI：`packages/agent-remnote/src/commands/read/search-plugin.ts`
  - WS bridge：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`
  - Plugin handler：`packages/plugin/src/bridge/runtime.ts`

## 覆盖矩阵（SC/FR/NFR）

| Code | 结论 | 证据（实现/测试/文档） | 漂移/缺口 |
|---|---|---|---|
| SC-001 | PASS | 插件在线候选集：`packages/agent-remnote/tests/contract/read-search-plugin.contract.test.ts` | 无 |
| SC-002 | PASS | DB 精筛 + 超时兜底：`packages/agent-remnote/tests/contract/read-search.contract.test.ts` | 无 |
| SC-003 | PASS | 插件预算 clamp：`packages/agent-remnote/tests/contract/read-search-plugin.contract.test.ts` | 无 |
| FR-001 | PASS | read-rpc 入口：`docs/ssot/agent-remnote/ws-bridge-protocol.md`、`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts` | 无 |
| FR-002 | PASS | 默认 limit=20 + clamp：`specs/005-search-safety/contracts/ws-read-rpc.md`、`packages/agent-remnote/tests/contract/read-search-plugin.contract.test.ts` | 无 |
| FR-003 | PASS | 默认 timeoutMs=3000 + clamp：同上 | 无 |
| FR-004 | PASS | 精简结构（remId/title/snippet）：`specs/005-search-safety/contracts/ws-read-rpc.md`、`packages/agent-remnote/tests/contract/read-search-plugin.contract.test.ts` | 无 |
| FR-005 | PASS | snippet 生成规则：`packages/plugin/src/bridge/runtime.ts`（从 text/backText 构造预览） | 无 |
| FR-006 | PASS | 禁止深度展开：契约约束 + plugin handler 实现仅返回 Top‑K 精简结构 | 无 |
| FR-007 | PASS | DB 查询硬超时隔离（<=30s）：`packages/agent-remnote/tests/contract/read-search.contract.test.ts`（作为新基线证据） | 无 |
| FR-008 | PASS | 插件不可用/超时回退与 nextActions：`packages/agent-remnote/tests/contract/read-search-plugin.contract.test.ts` | 无 |
| FR-009 | PASS | 建议型 nextActions：同上 | 无 |
| FR-010 | PASS | Skill 指引对齐：`$CODEX_HOME/skills/remnote/SKILL.md` | 无 |
| FR-011 | PASS | read-rpc 基于 connId 路由与隔离（依赖 003）：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`、`specs/003-ws-identity/acceptance.md` | 无 |
| NFR-001 | PASS | 预算字段/截断与 clamp：`specs/005-search-safety/contracts/ws-read-rpc.md`、`packages/agent-remnote/tests/contract/read-search-plugin.contract.test.ts` | 无 |
| NFR-002 | PASS | 超时不阻塞主线程：DB 查询隔离由实现与 contract tests 锁死（forward-only） | 无 |

## 漂移/缺口矩阵（聚焦问题）

- 无

## Next Actions（可选）

1) 若未来要把“两阶段搜索”提升为默认策略（而非显式 `read search-plugin`），建议按 forward-only 方式在 README/SSoT/contract tests 中显式固化 breaking，并提供最短迁移说明。  

