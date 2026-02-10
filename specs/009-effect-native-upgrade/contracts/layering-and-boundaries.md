# Contract: Layering & Module Boundaries（Effect Native 版）

**Date**: 2026-01-25  
**Spec**: `specs/009-effect-native-upgrade/spec.md`

## Why

“Effect Native 化”的核心不是“到处 import effect”，而是把异步/资源/副作用的控制权收口到可组合、可取消、可测试的边界里。

## Layer Rules (hard)

> 009 的最终裁决：以 `kernel/**` 作为可移植内核（见 `specs/009-effect-native-upgrade/contracts/portable-kernel-and-actors.md`）。

1) `packages/agent-remnote/src/kernel/**`
- MUST be portable & deterministic（禁止 `node:*`、`ws`、`better-sqlite3`、`effect/*`、`@effect/*`）
- MUST NOT read/mutate global state（含 `process.env`、`Date.now()`、`randomUUID()`、timers）
- MUST NOT depend on `src/commands/**`、`src/services/**`、`src/runtime/**`、`src/lib/**`

2) `packages/agent-remnote/src/services/**`
- MUST be the only place that touches low-level primitives directly（fs/ws/child_process/timers/workers/sqlite）
- MUST provide Tag/Layer boundaries for runtime/commands
- MAY depend on `src/kernel/**` to reuse pure domain logic / reducers

3) `packages/agent-remnote/src/runtime/**`
- MAY depend on `effect/*`, `src/services/**`, `src/kernel/**`
- SHOULD express long-running coordinators as Actors (single fiber owning mutable state)

4) `packages/agent-remnote/src/commands/**`
- SHOULD be thin: parse args → call runtime/services → format output

5) `packages/agent-remnote/src/internal/**`（legacy）
- 允许作为 008 存量落点存在，但 009 期间：
  - MUST NOT grow（禁止新增功能代码）
  - MUST be gradually decomposed into `kernel/**` + `services/**` + `runtime/**`
  - SHOULD be deleted when migration completes

## IO/Async Primitive Policy

- 禁止在 `commands/**` 与 `runtime/**` 中直接调用：
  - `setTimeout/setInterval/setImmediate/process.nextTick`
  - `new Promise`（除非在 `Effect.async` 的桥接层且有统一封装）
  - `child_process.spawn/exec/...`
  - `fs.*`（含 `fs.promises.*` 与 `fs.*Sync`；读写文件必须通过 `services/**`）
- 禁止在 `commands/**` 与 `runtime/**` 中通过 `process.env = ...` 注入配置（例如设置 queue db path）；env 只允许在 config/service 边界读取一次，然后以显式参数向下传递。
- 允许在 `services/**` 中出现，但必须被封装成 Effect API，并在 Scope 释放。

## Enforcement (planned)

- 扩展/更新 `packages/agent-remnote/tests/gates/module-boundaries.contract.test.ts`
- 新增 “primitive usage guard” contract test（扫描源码并输出违规点；允许 whitelist）
- 新增 `kernel/** portability guard`（禁止 `node:*`/`effect/*`/平台依赖）
