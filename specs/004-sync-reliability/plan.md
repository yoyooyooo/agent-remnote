# Implementation Plan: 同步可靠性（默认 notify + 兜底 kick）

**Branch**: `004-sync-reliability` | **Date**: 2026-01-24 | **Spec**: `specs/004-sync-reliability/spec.md`  
**Input**: Feature specification from `specs/004-sync-reliability/spec.md`

## Summary

把“写入后尽快被消费”变成默认行为，并为常见异常提供后端兜底：

1) **默认实时（CLI）**：写入类命令默认 `notify=true` + `ensure-daemon=true`（可显式关闭），入队后立即触发一次同步。
2) **长尾兜底（bridge kick）**：WS bridge 低频 kick（默认 30s）在“队列有活 + 有 active worker”时催一次 StartSync，并对“无进展”做升级（30s/90s）。
3) **降噪（plugin silent）**：插件对服务端 StartSync 默认 silent 运行 drain，避免 toast 噪音；手动命令仍可 toast。
4) **可观测（progress）**：以 `txn_id` 为单位提供轻量进度/终态查询，供 Agent 批量写入时判断是否需要收敛条件或人工介入。

依赖：Spec 003（`connId + active worker`，移除 `consumerId`）作为唯一消费与定向 kick 的基础。

## Technical Context

**Language/Version**: TypeScript（ESM）+ Node.js 20+  
**Primary Dependencies**: `effect` / `@effect/cli` / `ws` / `better-sqlite3`  
**Storage**: 队列 DB（`~/.agent-remnote/queue.sqlite`）+ WS state file（`~/.agent-remnote/ws.bridge.state.json`）  
**Testing**: `vitest`（主要在 `packages/agent-remnote`）+ `scripts/` 端到端模拟  
**Target Platform**: Node.js 20+（daemon/CLI）+ RemNote 桌面端插件运行时  
**Project Type**: bun workspace（`packages/*`）  
**Performance Goals**: 触发链路轻量、无空转；kick 默认 30s，且不引入 UI 噪音  
**Constraints**: 用户可见输出必须英文；不修改 `remnote.db`；forward-only evolution  
**Scale/Scope**: 单机多窗口/多端；默认唯一 active worker 消费队列

补充事实（现状差距）：

- CLI 已有 `notify/ensure-daemon` 入参并在 `enqueueOps` 内调用 `triggerStartSync`，但大部分命令的 flag 默认是 false（Options.boolean）。
- `enqueueOps` 里 ensure 目前走 `ensureWsDaemon`；而 `daemon sync` 走的是 `ensureWsSupervisor`（需收敛为 supervisor 模式）。
- 非 JSON 输出当前不会显示 `warnings[]`（`writeSuccess` 只打印 `md`），因此 `sent=0` 的重要提示容易被忽略。
- WS bridge 当前只有“被动触发 StartSync”（`TriggerStartSync`），没有定时 kick。
- 插件收到服务端 `StartSync` 当前会走 `silent: false`（会 toast），不符合“降噪”目标。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- 不直接修改 `remnote.db`：本 feature 仅影响“通知/兜底/观测”；写入仍走队列 + 插件执行器（PASS）。
- Forward-only evolution：允许把 CLI 默认值与 WS 协议行为升级为 breaking change；需同步更新 docs/ssot 与迁移说明（PASS）。
- SSoT 优先：WS kick/active worker 的裁决版以 `docs/ssot/agent-remnote/ws-bridge-protocol.md` 为准（PASS）。
- 预算与超时：kick 必须节流；所有循环必须可自动结束；无进展升级不能刷屏（PASS）。
- 用户可见输出英文：新增/调整的 CLI 提示必须英文（PASS）。
- Quality gates（实现前）：`npm run typecheck && npm run lint && npm run format:check && npm test`（PASS）。

## Project Structure

### Documentation (this feature)

```text
specs/004-sync-reliability/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cli.md
│   └── ws-kick.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/
├── agent-remnote/
│   ├── src/commands/_enqueue.ts
│   ├── src/commands/apply.ts
│   ├── src/commands/write/*
│   ├── src/commands/daily/*
│   ├── src/commands/wechat/*
│   └── src/commands/ws/_shared.ts
├── core/
│   └── src/ws/bridge.ts
└── plugin/
    └── src/bridge/runtime.ts
```

**Structure Decision**: 设计与契约落 `specs/004-sync-reliability/`；协议裁决与排障口径同步到 `docs/ssot/agent-remnote/**`。

## Phase Plan（落地顺序）

### Phase A（默认实时：CLI 默认 notify + ensure-daemon）

- 把写入类命令默认改为 `notify=true`、`ensure-daemon=true`，并提供显式关闭 flags：`--no-notify` / `--no-ensure-daemon`。
- 收敛 ensure 实现为 supervisor 模式（避免 `ensureWsDaemon`/`ensureWsSupervisor` 语义分裂）。
- 当 `sent=0` 时不视为失败，但必须在非 JSON 输出中可见（英文提示 + 建议动作）。

### Phase B（长尾兜底：bridge kick loop）

- 在 WS bridge 增加低频 kick 定时器（默认 30s），仅在满足条件时 kick：
  - 存在 active worker（Spec 003）且队列存在“可执行工作”（pending & due）
  - 且距离上次 kick/上次进展超过最小冷却
- 无进展升级：30s 无进展 → 重 kick/重选；90s 无进展 → 兜底策略（例如广播/强制接管，具体依赖 Spec 003 的接管语义）。
- 允许通过 env 关闭（interval=0）或调整 interval/cooldown。

### Phase C（降噪 + 防卡死：plugin silent + watchdog）

- 插件收到服务端 StartSync 默认以 silent 方式 drain（不 toast）；手动命令保留 toast。
- 可选：增加 sync watchdog（例如超过阈值仍 `syncing=true` 则自恢复），并写入诊断字段供 CLI 查询。

### Phase D（可观测：txn 进度/终态查询）

- 以 `txn_id` 为单位提供轻量查询（可选新增 `queue progress --txn`，或增强 `queue inspect --txn` 输出）。
- 定义 progress score 与终态口径（见 `specs/004-sync-reliability/data-model.md`）。

### Phase E（测试与文档）

- 增加最小契约测试：默认 notify/ensure 生效、`sent=0` 提示可见、StartSync silent 不刷 toast（通过可测信号间接验证）。
- 增加端到端脚本：模拟积压 + kick 唤醒 + 无进展升级（依赖 Spec 003 的 active worker 模型）。
- 更新 `docs/ssot/agent-remnote/ws-bridge-protocol.md` 与 `docs/guides/ws-debug-and-testing.md` 的口径。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| bridge kick loop | 避免触发丢失导致长尾积压 | 仅靠 CLI notify 仍会被瞬断/错过触发打断 |
| silent-by-default | 避免兜底 kick 带来 UI 噪音 | 每次 StartSync toast 会在 30s kick 下变成骚扰 |
