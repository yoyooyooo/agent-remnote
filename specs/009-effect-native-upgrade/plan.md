# Implementation Plan: Effect Native Upgrade（全链路 Effect Native 化）

**Branch**: `009-effect-native-upgrade` | **Date**: 2026-01-25 | **Spec**: `specs/009-effect-native-upgrade/spec.md`  
**Input**: Feature specification from `specs/009-effect-native-upgrade/spec.md`

## Summary

本计划的目标是把 `agent-remnote`（CLI + daemon/ws bridge）中“异步控制流 + 资源生命周期 + 副作用执行”统一迁移到 Effect runtime 下，并用 Actor/Controller 进行收口：

- **允许 breaking change（forward-only）**：不提供向后兼容层；如发生对外契约变化，必须同步更新 `docs/ssot/agent-remnote/**`、`README.md` / `README.zh-CN.md` 与相关 contract tests 作为新基线。
- **收口异步**：所有 timer/WS/subprocess/fs/worker 都通过 Effect Service/Layer 执行；业务逻辑只表达意图与组合关系。
- **配置收口**：所有 env/flags 的解析统一收口到 Effect `Config`/`ConfigProvider`（不再散落 `process.env.*` / 禁止 `process.env = ...` 注入）；优先级为 `CLI flags > env > defaults`。
- **状态栏文件化**：tmux 读取缓存文件；刷新由事件驱动触发且统一节流；daemon 不可达时 CLI 仍可写文件（至少 `↓N`）。
- **write-first 写入链路**：写入命令直接尝试入队（预检内化），并返回可行动的 `nextActions`（英文命令）；严格保持 `--json` 单 envelope 与 `--ids` 纯 stdout 语义。
- **测试对齐**：按 `specs/009-effect-native-upgrade/contracts/testing-strategy.md` 规划 contract/unit/integration-ish/static gates，并把每次改造的证据落到 tests（允许随 breaking change 更新为新基线）。

## Technical Context

**Language/Version**: TypeScript（ESM）+ Node.js 20+  
**Primary Dependencies**: `effect` / `@effect/cli` / `@effect/platform-node` / `ws` / `better-sqlite3`  
**Key Files Today**:
- ws-bridge（daemon）现处于 `packages/agent-remnote/src/internal/ws-bridge/**`（当前为 callback + timers 驱动）
- WsClient 现为 `new Promise + timer + ws.on` 模式（`packages/agent-remnote/src/services/WsClient.ts`）
- remdb-tools 部分采用 worker_threads + timer 硬超时（`packages/agent-remnote/src/internal/remdb-tools/searchRemOverview.ts`）
- wechat/outline 采用子进程 + timer（`packages/agent-remnote/src/commands/wechat/outline.ts`）
- commands 层存在散落的文件读取（`fs.readFile(...)`），以及通过 `process.env = ...` 的隐式配置注入（需在 009 中收口到 services/runtime）
- 现有配置解析在 `packages/agent-remnote/src/services/Config.ts` 中混合了 flags/env/defaults（含 `process.env.*` 读取）；009 将迁移为 Effect `Config`/`ConfigProvider.fromEnv`（由 `packages/agent-remnote/src/main.ts` 统一安装 provider）。

## Constitution Check

- 禁止直接修改 `remnote.db`（PASS；本计划不改变写入链路）。
- `--json` 输出纯度（PASS；需要确保刷新逻辑不污染 stdout/stderr）。
- internal/** 保持可抽包且 Effect-free（PASS；需要把 runtime 迁出 internal）。
- Forward-only evolution（PASS；允许重排目录与新增 runtime 层，不做向后兼容）。

## Project Structure

### Documentation (this feature)

```text
specs/009-effect-native-upgrade/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── tasks.md
├── contracts/
│   ├── layering-and-boundaries.md
│   ├── effect-io-guidelines.md
│   ├── ws-runtime.md
│   ├── status-line-file.md
│   └── testing-strategy.md
└── checklists/
    └── requirements.md
```

### Proposed Source Structure (target direction)

```text
packages/agent-remnote/src/
├── main.ts
├── commands/          # CLI presentation (effect programs)
├── services/          # Effect services (IO adapters, external boundaries)
├── runtime/           # Effect actors/controllers (long-running coordinators)
├── kernel/            # portable kernel (no node/effect)
├── lib/               # project helpers (may use node; kernel must not import lib)
└── internal/          # legacy (008 存量；009 期间逐步拆解/删除)
```

## Phase Plan（落地顺序）

### Phase 0（Research → `research.md`）

- 明确“非 Effect”异步热点清单与影响面（timer/WS/subprocess/fs/worker/daemon 生命周期）。
- 明确“边界门禁”的调整策略：新增 kernel 可移植性 gate；internal 视为 legacy（禁止新增），并逐步拆解迁移。

### Phase 1（Design → `data-model.md` + `contracts/*` + `quickstart.md`）

- 定义 runtime 事件模型与 Actor 收口点（尤其 StatusLineController / WsBridgeRuntime）。
- 定义 statusLine 文件契约（路径、格式、更新语义、daemon 不可达 fallback）。
- 定义 IO/异步编码规范（Effect acquireRelease/Scope/timeout/backpressure）。
- 更新/新增边界门禁（静态检查/contract tests）设计（只写计划，不实现）。
- 把“可移植内核（Cmd/Actor）”、“文件输入/路径解析”、“禁止 env 注入配置”的裁决补到 contracts，并在 tasks 里显式拆出实施任务（避免实现阶段再临时拍脑袋）。

### Phase 2（Implementation Skeleton）

> 本阶段属于后续实现，不在“只产出中间产物”范围内。

- 引入 `runtime/` 目录与最小骨架（不改行为）。
- 引入 `StatusLineController` 的 Service/Actor API（先空实现/适配层）。

### Phase 3（StatusLine File Mode）

- tmux 读取文件；daemon 统一更新文件并触发 refresh；CLI fallback 更新文件。

### Phase 4（WS bridge Effect 化）

- 把 ws-bridge 事件循环重构为 Effect Actor（心跳、踢人、超时、状态文件节流）。

### Phase 5（外围 IO Effect 化）

- WsClient：从 Promise/timer 改为 Effect acquireRelease + timeout + Deferred。
- subprocess/worker：抽出统一 Runner service；wechat/outline、remdb hard-timeout 统一接入。
- log writer：把 flushing/rotation 的调度收口到 Effect（或明确保留并加边界）。

## Complexity Tracking

| Risk | Mitigation |
|------|------------|
| 大规模重构引入行为回退 | 以 contract tests（允许随 breaking change 更新）作为硬 gate；分阶段迁移并同步更新 `docs/ssot/agent-remnote/**` 与 README（不做兼容层） |
| internal/** 与 runtime 的边界冲突 | 迁出 runtime（ws-bridge 等）到 `src/runtime/**`；更新边界门禁契约 |
| 高并发刷新导致 tmux 风暴 | StatusLineController 统一节流/合并；CLI fallback 也受同一最小间隔约束 |
