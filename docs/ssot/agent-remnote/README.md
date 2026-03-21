# agent-remnote · 协议与契约（SSoT）

本目录维护 agent-remnote 的**对外契约**与**关键协议**（当前必须为真），用于约束实现与避免文档漂移。

## 最短阅读路径

1. Store DB schema：`docs/ssot/agent-remnote/queue-schema.md`
   - 包含写入队列与 `workspace_bindings`
2. WS bridge 协议与插件集成：`docs/ssot/agent-remnote/ws-bridge-protocol.md`
3. CLI 对外契约：`docs/ssot/agent-remnote/cli-contract.md`
4. Host API 契约：`docs/ssot/agent-remnote/http-api-contract.md`
5. UI 上下文与持久化：`docs/ssot/agent-remnote/ui-context-and-persistence.md`
6. 写入工具语义：`docs/ssot/agent-remnote/tools-write.md`
7. 写入输入面矩阵：`docs/ssot/agent-remnote/write-input-surfaces.md`
8. SQLite 性能排查与优化：`docs/ssot/agent-remnote/performance-sqlite.md`
