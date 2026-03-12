# specs

本目录存放“特性规格（spec）”与其实现规划产物；仓库采用 **forward-only evolution**（允许 breaking，但必须 fail-fast + 可诊断）。

全局对齐裁决点见：`specs/CONCEPTS.md`（三平面：Control/Data/UX；WS 协议 v2；queue 迁移；id_map/幂等/冲突键等）。

每个 spec 目录通常包含：

- `spec.md`：目标/约束/验收场景（裁决点）
- `plan.md`：分阶段实施路线
- `tasks.md`：可执行任务清单（带文件落点）
- `data-model.md` / `contracts/**`：协议、数据模型与对外契约
- `quickstart.md` / `checklists/**`：实现后的本地验收清单

## 后续仍需实施的路线

> 目标：在“多客户端（桌面/网页/多窗口）来回切换 + agent 持续写入”下，保证队列消费与写入一致性，并在此基础上提升吞吐、收口命令、支持批量 write plan。

### M1：多客户端执行安全基线（013）

- Spec：`013-multi-client-execution-safety/`
- 为什么先做：后续的 batch pull / write-first / write plan 都会放大“回执覆盖/状态回滚/映射漂移”的代价；必须先把正确性地基钉死。
- 核心交付：
  - `attempt_id`（派发尝试标识）贯穿 queue + WS 协议
  - `OpAck` 落库 CAS（只允许确认当前 in-flight attempt）
  - 终态不可回滚 + lease 回收保守
  - 插件 ack 重试（AckOk 驱动）与 `id_map` 不漂移语义

### M2：批量拉取 + 冲突感知调度（010）

- Spec：`010-batch-pull-conflict-scheduler/`
- 依赖：必须基于 013 的 attempt_id/CAS ack 语义实现（避免多客户端切换 + lease 回收导致 stale ack 覆盖）。
- 推荐推进顺序（与 `plan.md` 对齐）：
  1. 协议升级（breaking，WS Protocol v2 合并包）：`Register.protocolVersion=2` + `RequestOps/OpDispatchBatch` + `attempt_id` 绑定回执（`OpAck/AckOk/AckRejected`）（旧 `RequestOp` fail-fast）
  2. MVP：仅 batch pull（不做调度）
  3. 调度器：ConflictKey 贪心挑选（并把全局 in_flight 冲突键纳入 `usedKeys`）
  4. 冲突面报告：`queue conflicts`

### M3：写入命令收口（011）

- Spec：`011-write-command-unification/`
- 依赖：与 013 的“回执确认/重试”基线一致（避免 write-first 默认行为引导到不安全重试路径）。
- 核心交付：
  - raw 入队能力收口为唯一入口 `write advanced ops`（默认 notify/ensure-daemon 策略一致）
  - 删除/拒绝重复入口（forward-only）
  - 失败诊断与 `nextActions[]` 契约固化（contract tests）

### M4：批量写入 write plan（012）

- Spec：`012-batch-write-plan/`
- 依赖：011（命令收口与输出契约）+ 013（attempt/CAS/映射稳定）；可选依赖 010（若希望更高吞吐）。
- 核心交付：
  - plan kernel（parse/validate/compile）+ CLI `write plan`
  - txn 级幂等（idempotency_key 冲突返回已有 txn）
  - dispatch-time substitution（temp id → remote id）+ `id_map` 不漂移检测
  - integration-ish：ack 回填后后续 op payload 被正确替换

## 可选并行/后续扩展（按需纳入路线）

- `019-local-host-api-and-stack/`：把宿主机 authoritative runtime 通过本机 Host API 暴露给容器内 agent，并新增 `api` / `stack` 命令面（本机自用优先，不引入 auth 复杂度）。

- `021-host-api-remote-surface-and-workspace-binding/`：把 019 继续推进到“通用远程 API + workspace 自动绑定”阶段，统一 container / remote caller 语义，补齐 `apiBasePath`、capability 状态面、以及零配置稳定选库。

- `015-ws-backpressure-and-lease-extension/`：补齐 010 的 `maxBytes` 背压与 lease 策略缺口，并落地续租（LeaseExtend），降低断线/重派发/重复副作用窗口（任务需反哺 SSoT）。
- `006-table-tag-crud/`：为 `write plan` 扩展更多原子写入 action（table/tag/property 等）。
- `008-agent-module-reorg/`：若需要更彻底的模块边界/抽包演进，再推进该目录的规划。
- `002-daemon-supervisor/`：若需要把 daemon 生命周期管理独立成更强的 supervisor 内核，再推进该目录的规划。
