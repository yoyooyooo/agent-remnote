# Research 004：同步可靠性（默认 notify + 兜底 kick）

**Feature**: `specs/004-sync-reliability/spec.md`  
**Date**: 2026-01-24

## 关键事实（来自当前实现）

### CLI：写入后 notify 已存在，但默认不生效

- 入口：`packages/agent-remnote/src/commands/_enqueue.ts`
  - `enqueueOps({ notify, ensureDaemon })`：在 `notify=true` 时调用 `ws.triggerStartSync(...)`
  - 若 `sent===0`，会把提示写入 `warnings[]`，但非 JSON 输出默认看不到（`writeSuccess` 只打印 `md`）。
- 多数写入命令已经暴露 flags：
  - `agent-remnote apply`：`notify` / `ensure-daemon`（Options.boolean，默认 false）
  - `agent-remnote write md` / `write bullet`：同上（默认 false）
  - `agent-remnote queue enqueue`：同上（默认 false；但它更偏底层，不一定要改默认）

### daemon sync：ensure 走 supervisor，但与 enqueueOps 不一致

- `packages/agent-remnote/src/commands/ws/sync.ts`：`--ensure-daemon` 时调用 `ensureWsSupervisor(...)`。
- `enqueueOps` 内 ensure 当前走 `ensureWsDaemon(...)`（需要收敛到 supervisor 模式，避免语义分裂）。

### WS bridge：仅被动触发，无定时 kick

- `packages/agent-remnote/src/internal/ws-bridge/bridge.ts`
  - `TriggerStartSync` 触发 `notifyStartSync(targetConsumerId?)`，当前仍支持按 `consumerId` 定向或广播。
  - 未实现“定时 kick / 无进展升级”。

### plugin：服务端 StartSync 当前会 toast

- `packages/plugin/src/bridge/runtime.ts`
  - 控制通道收到 `{ type:'StartSync' }` 时，执行 `runSyncLoop(..., { silent: false })`（会 toast）。
  - 插件命令“Start sync”也走 `silent: false`（这是用户主动行为，可保留 toast）。

## Decision Log（把 003 推到可实施的关键裁决）

### D1：写入类命令默认 `notify=true` + `ensure-daemon=true`

- **Decision**：把“写入类命令”的默认行为改为实时同步；仍保留 `--no-notify/--no-ensure-daemon` 作为显式关闭。
- **Rationale**：用户不应记 flags；且写入后不消费会造成“以为写了但没落库”的错觉。
- **Open**：哪些命令属于“写入类命令”（建议见 `specs/004-sync-reliability/contracts/cli.md`）。

### D2：`sent=0` 不算失败，但必须可见且可行动

- **Decision**：`sent=0` 视为“已入队但当前无 active worker”，CLI 必须输出英文提示并给出建议动作（不返回非零退出码）。
- **Rationale**：这是常见状态，不应让上游误判“写入失败”；但必须避免静默。

### D3：bridge 增加 kick loop（默认 30s）+ 无进展升级（30s/90s）

- **Decision**：实现低频 kick，只在“队列有活 + 有 active worker”时触发；并对无进展做升级策略。
- **Rationale**：notify 可能丢失；kick 是长尾保险。
- **Open**：无进展的“进展”定义（建议用 `lastDispatchAt/lastAckAt` 等内部计数器，见 data-model）。

### D4：插件对服务端 StartSync 默认 silent

- **Decision**：服务端触发的 StartSync 必须 silent drain（不 toast）；手动命令保留 toast。
- **Rationale**：否则 kick 会变成 UI 噪音。
- **Implementation note**：优先不改 WS 协议，仅按“消息来源”区分（服务端 StartSync = silent）。

### D5：进度查询以 txn 为单位（轻量）

- **Decision**：提供 `txn_id` 级别的轻量查询（可新增 `queue progress --txn`，或增强 `queue inspect --txn` 输出）。
- **Rationale**：让 Agent 能判定“是否需要等待/重试/收敛条件”。
- **Open**：score 口径（dead 是否算完成；failed 如何表达）。
