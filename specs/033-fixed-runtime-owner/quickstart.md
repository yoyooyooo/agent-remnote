# Quickstart: 033-fixed-runtime-owner

日期：2026-03-28

## 目标

给实现完成后的最小验收路径，重点验证：

- fixed URL 的 canonical owner 只有一个
- stable published install 是默认 owner
- source-tree 默认进入 isolated dev profile
- `doctor --fix` 能修 deterministic ownership 问题
- `stack takeover --channel dev|stable` 能显式切换 fixed owner
- packed install 与 source-tree 并存场景有自动化 gate

## 验收模式

### A. Deterministic Contract Gate

用于 CI / premerge / 本地稳定复现。

要求：

- 不依赖真实 RemNote 桌面端
- 用临时 runtime root / claim fixture / fake pid-state metadata 复现冲突
- 覆盖 stable default、isolated dev default、takeover、reclaim、doctor fix
- 覆盖 packed install launcher 与 source-tree launcher 共存

### B. Manual Host Smoke

用于真实机器最后抽查。

要求：

- 机器上同时存在 published install 与 source repo
- fixed URL 保持不变
- takeover/reclaim 后状态输出与 claim 一致

## A. Deterministic Contract Gate 步骤

1. 跑 runtime profile / runtime root contract tests。

```bash
npm test --workspace agent-remnote -- \
  tests/contract/runtime-owner-profile.contract.test.ts
```

2. 跑 ownership status / metadata contract tests。

```bash
npm test --workspace agent-remnote -- \
  tests/contract/runtime-owner-status.contract.test.ts
```

3. 跑 doctor deterministic repair tests。

```bash
npm test --workspace agent-remnote -- \
  tests/contract/runtime-owner-doctor.contract.test.ts
```

4. 跑 takeover / reclaim contract tests。

```bash
npm test --workspace agent-remnote -- \
  tests/contract/runtime-owner-takeover.contract.test.ts
```

5. 跑 direct lifecycle canonical-port claim-policy tests。

```bash
npm test --workspace agent-remnote -- \
  tests/contract/runtime-owner-direct-start.contract.test.ts
```

6. 跑 lifecycle integration smoke。

```bash
npm test --workspace agent-remnote -- \
  tests/integration/runtime-owner-lifecycle.integration.test.ts
```

7. 跑 packed install + source-tree coexistence gate。

```bash
npm test --workspace agent-remnote -- \
  tests/integration/runtime-owner-packed-vs-source.integration.test.ts
```

## B. Manual Host Smoke 步骤

1. 在 `~` 下确认发布版为 Volta shim 实际命中的版本。

```bash
which agent-remnote
volta which agent-remnote
agent-remnote --json config print
```

2. 查看默认 stable claim 与 live stack 状态。

```bash
agent-remnote --json stack status
agent-remnote --json doctor
```

3. 在源码 worktree 中查看默认 dev profile 是否隔离，并确认它没有改写 canonical owner。

```bash
npm run dev -- --json config print
npm run dev -- --json stack status
```

4. 执行显式 dev takeover 之前，确保源码 plugin artifacts 已就绪；若命令 fail-fast，不得继续 claim transfer。

```bash
agent-remnote stack takeover --channel dev
agent-remnote --json stack status
```

5. 如结果提示需要 RemNote reload，则重载桌面端，再验证 fixed URL 仍未变化。

6. 执行 stable reclaim。

```bash
agent-remnote stack takeover --channel stable
agent-remnote --json stack status
agent-remnote --json doctor --fix
```

## 通过标准

- fixed-owner claim 永远只指向一个 owner
- source-tree 默认不改写 stable runtime artifacts
- `doctor --json` 可读出 claim、live owner、冲突、repairability
- `doctor --fix` 不会在 ambiguous conflict 上乱动 owner
- dev takeover 和 stable reclaim 都能形成单一 final owner
- direct `daemon/api/plugin start|ensure` 在 canonical ports 上不能绕过 fixed-owner claim
- dev takeover 在 plugin artifacts 不可用时会 fail-fast，且不改 claim
- packed install 与 source-tree 共存的自动化 gate 全绿
- 文档与 status 字段对 stable/dev/runtime root 的命名一致
