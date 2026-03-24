# Checklist: Performance Live Verification

日期：2026-03-23

## 目标

用于在真实 RemNote 宿主环境中验证本波 performance uplift 没有偏离语义边界，同时确实吃到预期的 silent batching / queue / WS / plugin 收益。

## 预检查

- [ ] `agent-remnote stack ensure --wait-worker` 成功
- [ ] active worker 已连接
- [ ] 当前 worktree 与 shim 指向一致
- [ ] 本轮涉及的 plugin 改动已重载 RemNote 客户端

## Caller Neutral

- [ ] 用普通业务语义 surface 发起一次 `apply kind=actions`
- [ ] 不使用任何 `*Many` caller surface
- [ ] 通过 dry-run / queue inspect 确认 runtime 已静默收口为 bulk op

## Scenario Run

- [ ] 对 builtin scenario 执行一次 `--dry-run`
- [ ] 确认 `compiled_execution.kind=apply_actions`
- [ ] 当 selection > 1 时，确认 actions 已下降为 internal bulk family，而不是逐项 scalar action
- [ ] 执行一次真实 `scenario run --wait`
- [ ] 记录 `txn_id`、`ops_total`、`elapsed_ms`

## Queue / WS

- [ ] 通过 `queue inspect` 确认 txn 里的 op 数量符合 bulk-first 预期
- [ ] 通过 WS 日志或 integration harness 确认存在 `OpDispatchBatch`
- [ ] 若本轮包含多 ack，确认存在 `OpAckBatch` / `AckBatch`
- [ ] 检查没有出现异常 `AckRejected` / `ID_MAP_CONFLICT` / `OP_PAYLOAD_TOO_LARGE`

## Plugin Runtime

- [ ] 确认 bulk handler 实际执行成功
- [ ] 对同 parent 结构写确认顺序未漂移
- [ ] 对 rem-scoped bulk 写确认无越界串行化/死锁

## 用户可见结果

- [ ] outline / inspect 结果与调用意图一致
- [ ] 没有多写、漏写、顺序反转
- [ ] 失败回退路径仍然可诊断

## 通过标准

- [ ] caller 无需为性能专门改写 command surface
- [ ] bulk-first 明显降低 op 数与 ack 数
- [ ] live 结果与 contract tests 保持一致
