# Implementation Plan: Store DB 通用化（queue.sqlite → store.sqlite + Schema 命名空间 + forward-only migrations）

**Branch**: `017-queue-db-generalize` | **Date**: 2026-01-27 | **Spec**: `specs/017-queue-db-generalize/spec.md`  
**Input**: Feature specification from `specs/017-queue-db-generalize/spec.md`

## Summary

把当前“写入队列 DB（queue.sqlite）”升级为“通用持久化 Store DB（store.sqlite）”：

- **命名统一**：默认 DB 文件名改为 `store.sqlite`；用户侧不再把它称为 queue DB。
- **迁移机制内建**：Schema 演进与迁移逻辑随 `agent-remnote` 发布；打开 DB 时自动迁移；版本不匹配 fail-fast + 可执行 next actions（英文）。
- **迁移系统加固（专业化）**：引入迁移审计表 + checksum 漂移检测；迁移 runner 强约束（连续版本/单一入口/可验证）；并发启动下的锁与退避（避免半迁移状态）。
- **Schema 命名空间**：队列相关表迁移为 `queue_*` 前缀；为自动化预留通用骨架表（`event_* / trigger_* / task_*`）。
- **非破坏性文件迁移**：仅存在 legacy `queue.sqlite` 时，首次运行自动生成 `store.sqlite`（不修改、不删除 legacy 文件）。

本特性只建立“可追溯的持久化基座”；任务执行策略（本地/外派/回调）可以后续逐步补齐，但持久化与幂等/审计必须先行。

## Technical Context

**Language/Version**: TypeScript（ESM）+ Node.js 20+  
**Primary Dependencies**: `effect` / `@effect/cli` / `better-sqlite3` / `ws` / `zod`  
**Storage**: Store DB（默认 `~/.agent-remnote/store.sqlite`）+ WS state file（`~/.agent-remnote/ws.bridge.state.json`）  
**Testing**: `vitest`（`packages/agent-remnote/tests/*`）+ `scripts/` 端到端脚本  
**Target Platform**: Node.js 20+（CLI/daemon）+ RemNote Desktop（plugin）  
**Project Type**: workspace monorepo（`packages/*`）  
**Performance Goals**: 打开 DB + 迁移必须在可接受时间内完成（典型 < 1s；重迁移需可诊断）  
**Constraints**: forward-only；禁止直接写 `remnote.db`；用户可见输出英文；路径解析必须跨平台  
**Scale/Scope**: 单机本地多窗口/多端；队列写入可靠性优先于自动化扩展

## Constitution Check

*GATE: Must pass before implementation. Re-check before feature close-out.*

- 禁止直接修改 `remnote.db`：本特性只调整我们自己的 Store DB（PASS）。
- Forward-only：表重命名/默认路径更名属于 breaking change；必须 fail-fast + 迁移说明，不引入长期兼容层（PASS）。
- SSoT：`docs/ssot/agent-remnote/queue-schema.md` 需同步升级为 Store 口径（路径/表名/版本）（PASS）。
- 预算与超时：`better-sqlite3` 无硬中断；迁移必须是短事务、可诊断、可重试（PASS）。
- 跨平台路径规范：默认路径与用户输入路径解析继续使用 `homedir()` + `join/normalize` + `~` 展开（PASS）。
- 用户可见输出英文：任何迁移/错误提示/next actions 必须英文；`--json` stdout 纯净（PASS）。
- 可验证性：需新增/更新最小 contract tests 覆盖“legacy 文件迁移 + schema 迁移 + 错误诊断”（PASS）。

## Project Structure

### Documentation (this feature)

```text
specs/017-queue-db-generalize/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cli.md
│   └── db-schema.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/agent-remnote/
├── src/services/Config.ts                 # 默认路径 + CLI/env 配置入口（queue -> store）
└── src/internal/
    ├── store/
    │   ├── schema.sql                     # Store DB canonical schema（包含 queue_* + 自动化骨架表）
    │   ├── db.ts                          # openStoreDb + file migration + schema migrations（唯一 owner）
    │   ├── migrations/                    # 每个 migration 一个文件（forward-only）
    │   │   ├── 0001-init.ts
    │   │   ├── 0002-add-op-attempt-id.ts
    │   │   ├── 0003-add-op-attempts-table.ts
    │   │   └── 0004-add-txn-dispatch-mode.ts
    │   └── index.ts                       # store exports
    ├── queue/
    │   ├── dao.ts                         # 需整体改为 queue_* 表名（通过 store db 打开）
    │   ├── sanitize.ts
    │   └── index.ts                       # queue exports（从 store/db.ts 获取 DB handle/type）
    └── ws-bridge/                         # 依赖队列表名/统计的逻辑需对齐

docs/ssot/agent-remnote/
└── queue-schema.md                        # 需更新为 Store DB 口径（或更名为 store-schema.md 并更新引用）
```

**Structure Decision**:

- 迁移逻辑的唯一“所有者”必须是**打开 DB 的模块**（避免多个入口各自迁移造成漂移）。
- 本特性直接引入 `packages/agent-remnote/src/internal/store/` 作为 Store DB 的唯一 owner：
  - `store/schema.sql`：canonical DDL（包含所有命名空间表）
  - `store/db.ts`：`PRAGMA user_version` + migration runner + legacy 文件迁移（`queue.sqlite -> store.sqlite`）
  - `store/migrations/*.ts`：每个 migration 一个文件；按 user_version 顺序执行（便于测试与审计）
- `packages/agent-remnote/src/internal/queue/*` 只承载 queue 领域 DAO/校验/编译逻辑；不得再各自维护迁移或 schema 版本号。

## Phase Plan（落地顺序）

### Phase 0（Artifacts 基线）

- 完成本目录的 `research.md / data-model.md / contracts/* / quickstart.md / tasks.md`，作为实现基线与验收入口。

### Phase 1（用户侧命名统一：store db）

- 增加配置入口（用户侧只暴露 store 语义）：
  - CLI flag：`--store-db`
  - Env：`REMNOTE_STORE_DB` / `STORE_DB`
- 默认路径改为：`~/.agent-remnote/store.sqlite`。
- 旧入口（`--queue-db` / `REMNOTE_QUEUE_DB` / `QUEUE_DB`）作为**内部兼容别名**仅用于过渡：
  - 不在 help/README/SSoT 中继续宣传
  - 不输出警告（避免破坏 `--json` 输出纯度）
  - 仅作为 fallback 解析用户环境（若存在）

### Phase 2（非破坏性文件迁移：queue.sqlite → store.sqlite）

- 当 `store.sqlite` 不存在但 legacy `queue.sqlite` 存在时：
  - 自动生成 `store.sqlite`（推荐：copy to temp + atomic rename），确保 legacy 文件不被修改/覆盖。
  - 迁移后继续在 `store.sqlite` 上执行 schema migrations。
- 当 `store.sqlite` 与 `queue.sqlite` 同时存在且用户未显式指定路径时：
  - 默认使用 `store.sqlite`
  - 若检测到“两个文件都看似活跃”（例如都有未完成 txn）则 fail-fast，并给出可行动 next actions（英文）指导用户选择其一（避免隐式合并）。

### Phase 2.5（Migration Hardening：审计 + 漂移检测 + 并发锁）

- 迁移审计表：
  - 在 store schema 中加入 `store_migrations`（或等价表），记录：`version/name/checksum/applied_at/app_version`。
  - 每次应用迁移必须写入审计表；启动时校验已应用迁移的 checksum 与当前代码一致，检测漂移后 fail-fast。
- Runner 强约束：
  - `store/migrations/index.ts` 作为唯一迁移清单（顺序与版本号由代码显式声明），启动时断言“版本号连续 + 唯一 + 文件名/描述一致”。
  - 每个迁移提供轻量 `validate()`，在迁移前/后检查关键不变量（例如必要表/列存在）。
- 并发与锁：
  - 设置 `busy_timeout`（或等价策略），迁移时使用 `BEGIN IMMEDIATE`/写锁抢占，避免并发进程同时迁移导致半状态。
  - 对 `database is locked` 做有限次数重试 + 退避，并在失败时输出可行动的 next actions（英文）。

### Phase 3（Schema 命名空间迁移：队列表 → queue_*）

- bump `PRAGMA user_version`（新版本号由实现裁决，并与 SSoT 同步）。
- 增加迁移步骤（transactional）：
  - 重命名 legacy 表：`txns/ops/op_* / id_map / consumers` → `queue_*`
  - 补齐必要索引（必要时丢弃旧索引并重建）
  - 保持外键与约束一致
- 全仓库更新所有 SQL/DAO 查询到新表名；禁止用 view/alias 做长期兼容层。

### Phase 4（自动化骨架表：可追溯但不绑定具体执行策略）

新增最小模型（字段优先稳定、细节放 `config_json/payload_json`）：

- `event_*`：插件/系统观测事件（例如 tag add），包含确定性 `dedupe_key`
- `trigger_*`：规则（启用/禁用 + config）
- `task_*`：任务定义（kind + config）
- `task_run_*`：运行实例（状态机 + 目标 Rem + 结果 Rem + 关联 event/trigger/task）

并规定与队列的关联方式：

- `task_run_id` 必须可追溯到对应的 queue txn（建议：txn.meta_json 中写入 `task_run_id` + 在 `task_run` 表中记录 `txn_id` 或等价 link）。

### Phase 5（Docs / Tests / Close-out）

- 更新 SSoT 与用户文档：
  - 默认路径、配置入口、表名/版本、迁移策略
  - 任何用户可见提示/next actions 统一英文
- 新增/更新 tests（最小门禁）：
  - config：默认 store 路径 + store flag/env 覆盖
  - migration：只有 legacy queue.sqlite 时可生成 store.sqlite 且 legacy 文件不变
  - schema：从旧 user_version/旧表名可升级到新版本并可继续 enqueue/dispatch/ack

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 表重命名（txns/ops → queue_*） | 为 Store DB 引入清晰命名空间，避免未来任务/触发模块表名冲突 | 继续使用通用表名会导致语义歧义与未来冲突，且迁移成本会随时间增大 |
