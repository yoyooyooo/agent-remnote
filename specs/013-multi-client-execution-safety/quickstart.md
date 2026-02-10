# Quickstart (013): How to validate multi-client safety

> 本清单用于实现完成后的本地验收（无需真实 RemNote，也可用 ws-bridge integration harness）。

1. 启动 ws bridge（daemon）与一个“模拟插件”连接 A（worker=true）。  
2. 入队 1 条 op，A claim 并“延迟 ack”（模拟执行中）。  
3. 强制触发 lease 过期回收并让连接 B 接管（worker=true，active worker 迁移）。  
4. 让 A 发送迟到 OpAck(attempt=A1) → 预期：AckRejected，DB 无变化。  
5. 让 B 发送 OpAck(attempt=B1) → 预期：AckOk，op 进入终态且不可被回滚。  

