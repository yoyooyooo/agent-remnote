# agent-remnote · 协议与契约（SSoT）

本目录维护 agent-remnote 的**对外契约**与**关键协议**（当前必须为真），用于约束实现与避免文档漂移。

## 最短阅读路径

1. Store DB schema：`docs/ssot/agent-remnote/queue-schema.md`
   - 包含写入队列与 `workspace_bindings`
2. WS bridge 协议与插件集成：`docs/ssot/agent-remnote/ws-bridge-protocol.md`
3. CLI 对外契约：`docs/ssot/agent-remnote/cli-contract.md`
4. Host API 契约：`docs/ssot/agent-remnote/http-api-contract.md`
5. UI 上下文与持久化：`docs/ssot/agent-remnote/ui-context-and-persistence.md`
6. 写入工具语义：`docs/ssot/agent-remnote/tools-write.md`
7. 写入输入面矩阵：`docs/ssot/agent-remnote/write-input-surfaces.md`
8. Runtime mode 与 command parity：`docs/ssot/agent-remnote/runtime-mode-and-command-parity.md`
9. SQLite 性能排查与优化：`docs/ssot/agent-remnote/performance-sqlite.md`

## 架构裁决补充

- command inventory 的最高裁决点仍是
  `docs/ssot/agent-remnote/runtime-mode-and-command-parity.md`
- 对于 Wave 1 parity-mandatory business commands，代码侧允许有两类派生产物：
  - `packages/agent-remnote/src/lib/business-semantics/commandInventory.ts`
  - `packages/agent-remnote/src/lib/business-semantics/commandContracts.ts`
- `commandContracts.ts` 只做 Wave 1 executable contract registry，不能独立决定
  哪些命令进入 Wave 1
- Wave 1 business command 的 mode switch 只允许收口在
  `packages/agent-remnote/src/lib/business-semantics/modeParityRuntime.ts`
  及其 local / remote adapters

## Runtime Ownership（当前定型）

- canonical fixed-owner control plane 根目录仍是 `~/.agent-remnote`
- 发布安装态默认是 canonical `stable` owner
- source worktree 默认进入 isolated `dev` runtime root 与 deterministic isolated ports
- `config print` / `stack status` / `doctor --json` 是当前 owner/profile/claim 的正式观察入口
- `stack ensure|status|stop|takeover` 当前都围绕 `daemon + api + plugin` 的 bundle 工作
- direct `daemon/api/plugin start|ensure` 若目标是 canonical ports，也必须 obey fixed-owner claim policy
