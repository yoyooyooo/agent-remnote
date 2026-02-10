# Implementation Plan: WS Backpressure + Lease Strategy/Extension (015)

## Summary

补齐 010 的 `maxBytes` 背压与 lease 策略缺口，并把 013 的 LeaseExtend 协议位落地为可用机制：降低断线/重派发/重复副作用窗口，同时保持可诊断与可收敛。

## Phase Plan

### Phase 0：裁决与 SSoT 对齐

- 明确预算字段（`maxBytes/maxOpBytes`）与估算口径；定义稳定错误码与 nextActions。
- 在 SSoT：`docs/ssot/agent-remnote/ws-bridge-protocol.md`、`docs/ssot/agent-remnote/queue-schema.md` 固化语义。

### Phase 1：Daemon budget enforcement（server-side）

- `RequestOps` 解析 `maxBytes/maxOpBytes`，并做 clamp（带可诊断回显）。
- batch 构建按预算装箱：保证 `OpDispatchBatch` 不超预算；提供 skipped 统计。
- 单条 op oversize：进入可收敛终局（避免无限抖动）。

### Phase 2：Lease policy（server-side）

- 统一 lease clamp（min/max），并实现按 `op_type`/payload 大小动态 lease。
- 增加 reclaim grace（可选）：到期后宽限小窗口再回收，降低边界抖动。

### Phase 3：LeaseExtend（protocol + plugin）

- Daemon：实现 `LeaseExtend`（CAS：`locked_by + attempt_id` 命中才延长）。
- Plugin：在执行较长 op 时定期发送 `LeaseExtend`（不触发 toast；失败仅低噪日志）。

### Phase 4：Tests（回归基线）

- Contract：batch 字节预算永不超；单 op oversize 的稳定错误码与 nextActions。
- Integration-ish：模拟长 op（延迟 ack）+ 续租覆盖 + recoverExpiredLeases 不回收；以及 stale extend 被拒绝。
