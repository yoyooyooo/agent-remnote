# Contract: Effect IO Guidelines（异步与资源管理约定）

**Date**: 2026-01-25  
**Spec**: `specs/009-effect-native-upgrade/spec.md`

## Goals

- 所有 IO/异步都可取消、可超时、可组合
- 所有资源都有明确的 acquire/release
- 所有 burst 事件可合并并受背压控制

## Guidelines (normative)

1) Timers / Scheduling
- 使用 `Effect.sleep` + `Schedule`（而不是 `setTimeout/setInterval`）
- burst 合并使用 `Queue.sliding(1)` 或 `SubscriptionRef`/`Hub`（按需）
- 禁止在 timer/callback 中调用 `Effect.runPromise(...)`（会绕开 Scope/取消语义）；应把调度写成 Actor loop（`sleep` + event queue）或封装到 `services/**`。

2) Resource lifecycle
- Socket/worker/process/file handle 必须使用 `Effect.acquireRelease` 或 `Scope`
- 任何后台 fiber 必须绑定到 Scope，并在退出时自动中断

3) Timeouts & cancellation
- 使用 `Effect.timeout` / `Effect.timeoutFail` 表达超时
- 不允许通过手写 `Promise.race([p, timeout])` 实现超时（除非封装在 service 且提供可取消语义）

4) Subprocess / Worker
- 统一走 Runner service（标准化：超时、输出收集、kill/terminate、诊断字段）

5) Output purity
- `--json` 模式下 stdout 必须保持单行 JSON；任何诊断输出必须走 stderr，且在 `--json` 模式必须为空

6.5) Portable kernel boundary (critical)
- `kernel/**` 不得返回 `Effect`；必须以“纯函数 + Cmd[]”表达意图（见 `specs/009-effect-native-upgrade/contracts/portable-kernel-and-actors.md`）。
- `kernel/**` 不得调用 `Date.now()`/`randomUUID()`/timers；时间与唯一 ID 必须由 runtime/services 注入（作为 Event 字段或 Cmd 执行结果回灌）。

6) File inputs & user paths
- 所有用户输入路径必须支持 `~` 展开并立即 `normalize`（由单一入口负责；建议复用 `packages/agent-remnote/src/lib/paths.ts`）。
- 任何 “读取文件/从 stdin 读取” 都必须封装成 service（例如 `services/FileInput.ts`），以统一：
  - `@file` / `-` / inline text 的 spec 解析
  - 大小上限（避免 OOM）
  - 错误码与诊断字段（`INVALID_ARGS` vs `INVALID_PAYLOAD` vs `PAYLOAD_TOO_LARGE`）

7) Configuration flow
- 禁止用 `process.env = ...` 作为模块间参数传递；env 只在 config/service 边界读取一次，然后以显式参数向下传递（尤其是 queue db path、state file path 等）。

## Exceptions

- tests 中允许使用少量 Node 原语构造 stub（例如 spawn dummy process），但应局部化并加超时，避免悬挂。
