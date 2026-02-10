# Data Model: Effect Native Runtime（模块、事件与状态栏模型）

**Date**: 2026-01-25  
**Spec**: `specs/009-effect-native-upgrade/spec.md`

## 模块分层（目标态）

### Layers

1. **commands/**（Presentation）
   - 只负责命令编排/参数解析/输出格式
   - 不直接触达低层原语（timer/spawn/fs/ws）

2. **services/**（IO Adapters）
   - 以 Tag/Layer 形式提供外部边界：Fs/Process/Tmux/WsClient/Clock/WorkerRunner 等
   - 统一错误建模与诊断字段
   - 统一 file spec / user path 解析（`@file` / `-` / `~`），避免命令层散落 fs 调用

3. **runtime/**（Actors/Controllers）
   - 长驻协调器：WsBridgeRuntime / StatusLineController / DaemonSupervisorRuntime 等
   - 统一节流/背压/取消语义

4. **kernel/**（Portable Kernel）
   - 可移植纯内核：只做纯逻辑/状态机/渲染/约束，不触达 IO 原语
   - 以 `reduce(state, event) -> { state, cmds[] }` 形式输出 Cmd，由 runtime 解释执行（见 `contracts/portable-kernel-and-actors.md`）
   - 禁止依赖 Node/Effect（不可导入 `node:*` / `ws` / `better-sqlite3` / `effect/*` / `@effect/*`）

5. **internal/**（Legacy, 008 存量）
   - 允许存在作为过渡，但禁止新增；目标是拆解迁移到 `kernel/**` + `services/**` + `runtime/**`

## Runtime Events（概念模型）

> 目的：把“刷新/同步/状态变化”的意图统一为事件流，交由 Actor 收口处理。

### Event (examples)

- `SelectionChanged`（来源：plugin → ws-bridge）
- `UiContextChanged`（来源：plugin → ws-bridge）
- `QueueEnqueued`（来源：CLI enqueue/apply/write/replace）
- `OpDispatched`（来源：ws-bridge dispatch）
- `OpAcked`（来源：plugin ack）
- `BridgeStateWritten`（来源：ws-bridge state snapshot）
- `DaemonHealthTick`（来源：ws-bridge heartbeat）
- `StatusLineInvalidate`（来源：任何希望更新 statusLine 的地方）

事件字段约定（关键）：
- `now` 必须由 runtime 注入（生产用真实时钟；测试用 TestClock/可控输入）
- 任何 requestId/connId 等唯一 ID 必须由 services/runtime 注入，kernel 不得自行生成

## StatusLine Model

### Inputs

- **ws bridge state snapshot**（已有）：提供 active worker/clients/selection/uiContext/updatedAt 等
- **queue stats**（已有）：提供 pending/in_flight 等（用于计算 outstanding）

### Derived Fields

- `connection`：`ok | down | stale | off | no_client`（由 ws state 判定）
- `selection`：`none | text | rem(count)`（沿用既有归一化语义）
- `queueOutstanding`：`pending + in_flight`（用于渲染 `↓N`）

### Rendered Output (string)

- 若连接信息可用（ok）：沿用既有 base 输出（`RN` / `TXT` / `N rems`），并在 `queueOutstanding>0` 时追加 `↓N`
- 若连接信息不可用但 `queueOutstanding>0`：至少输出 `↓N`
- 若连接信息不可用且队列为 0：输出空串（tmux 不显示）

## Persisted Files（目标态）

- `statusLineFile`：tmux 读取的缓存文件（单行文本；原子写）
- `wsBridgeStateFile`：桥接快照（既有）
- `daemon pid/log/state`：supervisor files（既有）

## Dependencies（允许方向）

- `commands/*` → `services/*` + `runtime/*` + `lib/*`
- `runtime/*` → `services/*` + `kernel/*` + `lib/*`
- `services/*` → `kernel/*` + `lib/*`
- `kernel/*` → `kernel/*`（禁止依赖 `commands/services/runtime/lib/node/effect`）
- `internal/*` → `internal/*`（legacy；禁止新增，并逐步迁移）
