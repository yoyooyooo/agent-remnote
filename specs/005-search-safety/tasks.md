# Tasks 005：安全搜索（插件候选集 + DB 精筛 + 超时兜底）

> 已实现 read-rpc、插件候选集、以及 DB 侧“30s 硬超时隔离”；剩余工作是高风险查询点预算化与 Skill 指引对齐（forward-only）。

- [x] T001 固化需求决策（插件 timeout=3s；默认 limit=20；DB 单次硬超时=30s；失败返回建议型 nextActions）
- [x] T010 协议（SSoT）：WS bridge 增加 read-rpc：`SearchRequest/SearchResponse`（requestId/timeout/errors）
- [x] T015 依赖：先完成 Spec 003（移除 `consumerId` + `connId/clientInstanceId` + active worker 选举），再落地 read-rpc
- [x] T020 core/bridge：实现 read-rpc 路由与超时回收（避免悬挂请求）
- [x] T030 plugin：实现 `SearchRequest` handler（limit clamp + 3s timeout + snippet 生成 + payload 截断）
- [x] T040 CLI：提供专用“插件候选集搜索”命令（阻塞式等待插件响应；失败/超时回退到 DB 或给 nextActions）
- [x] T050 core/tools：DB 查询执行器迁移到 worker/子进程（30s 硬超时 + 预算字段 + 统一错误）
- [x] T060 core/tools：梳理并改造高风险查询点（分页/limit/timeRange/maxNodes；避免全量遍历）
- [x] T070 文档：更新 `docs/ssot`（协议/边界）+ 更新 `docs/proposals`（方案细节与示例）
- [x] T080 Skill：完善 `$remnote`（两阶段搜索套路、预算、回退、nextActions 指引；仅维护全局 `$remnote`，不提供项目级覆盖）
