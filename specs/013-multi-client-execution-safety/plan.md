# Implementation Plan: Multi-Client Execution Safety (013)

## Summary

把“多客户端切换下的写入正确性”收口为一组硬不变量（attempt_id + CAS ack + ack 重试），并把它作为 010/012 的基础设施依赖。

## Phase Plan

### Phase 0：文档与依赖对齐

- 锁定 attempt_id / CAS ack / AckOk 语义（本目录）。
- 在 010/011/012 中显式引用本 spec（dependency + tasks）。

### Phase 1：Queue 层（DAO + schema）

- schema：ops 增加 attempt_id（以及必要审计字段），可选新增 op_attempts。
- DAO：claim 时生成 attempt_id；ack 做 CAS；lease 回收保守；新增诊断查询。

### Phase 2：WS bridge 协议 + 实现

- OpDispatch/OpAck/AckOk 增加 attempt_id。
- 对 stale/invalid ack 返回 AckRejected。
- 可选：LeaseExtend（按 op 类型或执行时长启用）。

### Phase 3：Plugin executor

- ack 重试：直到收到 AckOk(attempt_id)；断线后重连继续 flush。
- dedup：对“同 op 重发 ack”必须返回一致 result（尤其是 created/id_map）。

### Phase 4：Tests

- Contract：stale ack 被拒绝；终态不可回滚；协议字段必填。
- Integration-ish：模拟“多客户端接管 + lease 过期 + 旧回执迟到”。

