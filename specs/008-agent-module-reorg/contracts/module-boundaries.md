# Contract: Module Boundaries（实施验收基准）

**Feature**: `008-agent-module-reorg`  
**Date**: 2026-01-24  
**Scope**: `packages/agent-remnote` 在合并 `packages/core` 后的目录与依赖边界约束

## 1) 目标

在不改变对外行为的前提下，让 `agent-remnote` 的内部结构满足：

- 能力有明确归属（队列/WS bridge/只读 DB 工具/CLI 编排/运维守护）。
- 依赖方向单向，避免“命令代码到处穿透”。
- 为未来抽包留下低成本演进路径（internal 可整体迁出）。

## 2) 强约束（Non-negotiable）

### 2.1 依赖方向

```text
main.ts
  └─ commands/**
      └─ services/**
          └─ internal/**
```

- `internal/**` 禁止依赖 `commands/**`、`services/**`、`@effect/cli`。
- `commands/**` 不得通过深路径直接引用 internal 的实现文件；只允许引用 internal 模块的入口（见 2.2）。

### 2.2 入口收口（No deep imports）

每个 internal 模块必须提供 **唯一入口**：

- `internal/queue/index.ts`
- `internal/ws-bridge/index.ts`
- `internal/remdb-tools/index.ts`

跨模块引用时必须从 `index.ts` import（或从 `internal/public.ts` 统一门面 import），禁止形如：

- ❌ `../internal/ws-bridge/bridge.ts`
- ❌ `../internal/queue/dao.ts`

### 2.3 用户可见契约不变

本 contract 重申“模块化重组不得影响”的对外不变量（验收由 tests + SSoT 锚点锁死）：

- `--json` 输出纯度：stdout 单行 JSON envelope；stderr 为空；exit code 语义不变。
- WS 协议语义不变（active worker、read-rpc、state file shape 与行为）。
- 队列 schema 与调度语义不变（lease、重试、幂等键、txn 内串行 gating）。
- 禁止直接写 `remnote.db`（所有写入仍走队列→bridge→插件）。

### 2.4 配置权威入口

- CLI 侧配置解析以 `services/Config.ts` 为权威入口。
- internal 模块可以保留 env 兼容（作为兜底），但 **跨模块传参不得依赖写 `process.env = ...`**；以显式参数为主。

## 3) 违反与处置

若实施阶段需要临时违反上述约束（例如为了“先无损搬迁”短期允许 deep import）：

- 必须在 `specs/008-agent-module-reorg/tasks.md` 的对应任务中写明：
  - 为什么必须违反
  - 何时回收（在后续任务修复）
  - 如何验证没有遗留

## 4) 验收信号

- `specs/008-agent-module-reorg/data-model.md` 中的模块映射与实际代码结构一致。
- 现有 `packages/agent-remnote/tests/contract/*.contract.test.ts`（CLI 契约）与 `packages/agent-remnote/tests/gates/*.contract.test.ts`（门禁）继续通过（作为“功能不变”的硬证据）。
