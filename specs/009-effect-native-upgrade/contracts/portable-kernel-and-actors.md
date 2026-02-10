# Contract: Portable Kernel & Actors（可移植内核 + Actor 解释器）

**Date**: 2026-01-25  
**Spec**: `specs/009-effect-native-upgrade/spec.md`

## Goal

在 009 中把“可移植内核”作为第一原则：

- **kernel 是纯内核**：不依赖 Node、不依赖 Effect、不读 env、不触达 IO 原语。
- **runtime 是解释器**：以 Actor（单 fiber 持有 mutable state）串行处理事件，解释执行内核产出的命令（Cmd）。
- **services 是平台边界**：所有 IO / 资源生命周期 / 调度 / 外部依赖（WS/FS/SQLite/child_process/tmux）都通过 Tag/Layer 提供可替换实现。

## Directory & Layering

Target structure（009 目标态）：

```text
packages/agent-remnote/src/
├── commands/          # CLI presentation (thin)
├── runtime/           # Actors/Controllers (Effect native)
├── services/          # IO adapters (Effect Services)
├── kernel/            # Portable core (no node/effect)
└── lib/               # project helpers (may use node; kernel must not import lib)
```

Legacy note（过渡期）：

- `src/internal/**` 目前仍含 Node/SQLite/ws 实现；009 期间允许作为 **legacy** 存量，但：
  - 禁止新增功能代码进入 `internal/**`
  - 迁移目标是把其职责拆到 `kernel/**` + `services/**` + `runtime/**`，最终删除/清空 `internal/**`

## Hard Rules（Non-negotiable）

### 1) `kernel/**` 必须可移植

`packages/agent-remnote/src/kernel/**`：

- MUST NOT import：
  - `node:*`（含 `node:fs` / `node:path` / `node:crypto` / `process` 等）
  - `ws` / `better-sqlite3` / `child_process` / `worker_threads`
  - `effect/*` / `@effect/*`
- MUST NOT call：
  - `Date.now()` / `Math.random()` / `randomUUID()`（或任何隐式随机/时间源）
  - `setTimeout/setInterval/setImmediate`
- MUST NOT read or mutate global state（含 `process.env`、global singletons）
- SHOULD be deterministic & side-effect free

### 2) 内核不返回 `Effect`，而是返回 `Cmd[]`

内核通过纯函数表达“接下来要做什么”：

- 输入：`State` + `Event`
- 输出：`NextState` + `Cmd[]`

建议最小骨架：

```ts
export type Event = { readonly _tag: 'Tick'; readonly now: number } | { readonly _tag: 'WsMessage'; readonly now: number; readonly msg: unknown };

export type Cmd =
  | { readonly _tag: 'WriteStatusLine'; readonly text: string }
  | { readonly _tag: 'QueueStatsRequest' }
  | { readonly _tag: 'WsSend'; readonly connId: string; readonly msg: unknown };

export type ReduceResult = { readonly state: State; readonly cmds: readonly Cmd[] };

export const reduce = (state: State, event: Event): ReduceResult => {
  // pure
  return { state, cmds: [] };
};
```

### 3) 时间/随机/ID：由 runtime/services 注入

- `Event.now` 由 runtime 注入（生产环境来自 Clock；测试可控）。
- 需要 requestId/connId 等唯一 ID 的地方，由 `services/IdGen`（或 runtime）生成并作为：
  - Event 字段，或
  - Cmd 执行结果的一部分回灌为 Event

内核不得“自己生成”时间/随机/ID。

## Actor Interpreter Pattern（runtime/**）

`runtime/**` 以单 fiber 持有 state，并保证：

- 所有外部输入（WS 消息/定时 tick/CLI 通知/队列变化）都先归一化为 `Event` 进入队列
- 串行调用 `kernel.reduce(state, event)` 得到 `cmds`
- 逐个解释执行 `cmds`（调用 `services/**`），并将结果再封装为新的 `Event` 回灌（如需要）
- 全流程可取消、可超时、可用 TestClock 做确定性测试

## Enforcement（Static Gates）

009 必须新增/更新门禁以锁死上述不变量：

- `kernel/**` 禁止 node/effect/第三方平台依赖的静态扫描 gate
- `runtime/**`/`commands/**` 禁止 raw timers/Promise/spawn/fs/ws 的静态扫描 gate
- 对 `src/internal/**` 的“禁止新增”策略：可通过 gate 限制新增文件或新增 import（实现阶段定义具体规则）

