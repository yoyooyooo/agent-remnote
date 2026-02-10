# Tasks: 017-queue-db-generalize

**Input**: Design documents from `specs/017-queue-db-generalize/`  
**Prerequisites**: `spec.md` + `plan.md`（required）, `research.md`, `data-model.md`, `contracts/*`, `quickstart.md`

> 约定：forward-only，允许 breaking；任何用户可见输出（错误信息/next actions）必须英文；`--json` 模式 stdout 纯净。

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 建立 Store 模块骨架：`packages/agent-remnote/src/internal/store/{index.ts,db.ts,schema.sql,migrations/}`
- [x] T002 [P] 新增 Store 相关导出：`packages/agent-remnote/src/internal/public.ts`（导出 `openStoreDb/StoreSchemaError` 等）
- [x] T003 [P] 补齐 feature 文档树：为 017 添加 `specs/017-queue-db-generalize/acceptance.md`（记录可复现验收命令）

---

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T004 迁移“迁移 owner”：把 `PRAGMA user_version` + migration runner 从 `packages/agent-remnote/src/internal/queue/db.ts` 移到 `packages/agent-remnote/src/internal/store/db.ts`
- [x] T005 [P] 统一 schema 来源：把 canonical DDL 迁移到 `packages/agent-remnote/src/internal/store/schema.sql`，并保持 bundling fallback snapshot 与之对齐
- [x] T006 [P] 拆分迁移文件：把 v1..vN 的迁移拆成 `packages/agent-remnote/src/internal/store/migrations/*.ts`（一个版本一个文件）
- [x] T007 实现 Store DB 打开流程：`openStoreDb()` 内部负责 `ensureDir + migrate + pragma`，并禁止其它模块私自迁移
- [x] T008 实现 legacy 文件迁移（non-destructive）：当仅存在 `~/.agent-remnote/queue.sqlite` 时生成 `~/.agent-remnote/store.sqlite`（WAL 安全：优先用 SQLite backup/VACUUM INTO 等一致性拷贝）
- [x] T009 增加 fail-fast 错误码与诊断字段（英文）：在 `packages/agent-remnote/src/internal/store/db.ts` 定义 `StoreSchemaError`（包含 `code/details/nextActions[]`）
- [x] T010 [P] 引入迁移审计表：在 `packages/agent-remnote/src/internal/store/schema.sql` 增加 `store_migrations`，并在迁移 runner 中写入 `version/name/checksum/applied_at/app_version`
- [x] T011 迁移 runner 强约束：新增 `packages/agent-remnote/src/internal/store/migrations/index.ts`（唯一迁移列表）；启动断言版本连续/唯一；校验 checksum 漂移并 fail-fast
- [x] T012 并发与锁：在 `packages/agent-remnote/src/internal/store/db.ts` 设置 `busy_timeout`；迁移用 `BEGIN IMMEDIATE`；对 `database is locked` 做有限重试+退避并输出英文 next actions

---

## Phase 3: User Story 1 - 统一“持久化存储”命名与默认路径 (Priority: P1) 🎯 MVP

**Goal**: 默认 DB 文件名与用户侧配置入口升级为 Store 语义（`store.sqlite` / `--store-db` / `REMNOTE_STORE_DB`）。  
**Independent Test**: 在干净环境下运行任一需要持久化的命令，只会创建并使用 `~/.agent-remnote/store.sqlite`；存在 legacy `queue.sqlite` 时可自动生成 store 且 legacy 不变。

- [x] T013 [US1] 新增 root flag：在 `packages/agent-remnote/src/main.ts` 把 `--queue-db` 替换为 `--store-db`（旧 flag 作为 fallback 解析，但不再出现在 help/README）
- [x] T014 [US1] 新增 env：在 `packages/agent-remnote/src/services/Config.ts` 支持 `REMNOTE_STORE_DB/STORE_DB`，默认改为 `~/.agent-remnote/store.sqlite`
- [x] T015 [US1] 更新所有英文诊断文案：替换 `--queue-db`/`REMNOTE_QUEUE_DB` 引导为 store 口径（例如 `packages/agent-remnote/src/services/Queue.ts`、`packages/agent-remnote/src/commands/doctor.ts`）
- [x] T016 [US1] 更新脚本与 tmux 状态栏：`scripts/tmux/remnote-right-value.sh` 与引用处从 queue env/path 改为 store（保留 queue env fallback）
- [x] T017 [US1] 更新单元测试：`packages/agent-remnote/tests/unit/config.unit.test.ts`（默认路径、env 优先级、`~` 展开）
- [x] T018 [US1] 更新契约/文档口径（路径与配置入口）：`AGENTS.md`、`README.md`、`README.zh-CN.md`、`docs/ssot/03-architecture-guidance.md`、`docs/ssot/agent-remnote/ui-context-and-persistence.md`

---

## Phase 4: User Story 2 - Schema 按模块前缀组织 (Priority: P2)

**Goal**: 队列相关表全部迁移为 `queue_*` 命名空间，避免与自动化表冲突。  
**Independent Test**: 初始化新 DB 后检查表名均为 `queue_*`；从旧表名 DB 迁移后 enqueue/dispatch/ack 仍工作。

- [x] T019 [US2] 设计并落地表重命名迁移：在 `packages/agent-remnote/src/internal/store/migrations/0005-prefix-queue-tables.ts` 增加 migration（`txns/ops/...` → `queue_txns/queue_ops/...` 等）
- [x] T020 [US2] 更新 canonical schema：`packages/agent-remnote/src/internal/store/schema.sql` 使用 `queue_*` 表名，并更新 fallback snapshot
- [x] T021 [US2] 全面更新 DAO/SQL：替换 `packages/agent-remnote/src/internal/queue/dao.ts`（以及相关查询）到新表名
- [x] T022 [US2] 更新依赖队列表名的运行时：搜索并修正 `packages/agent-remnote/src/services/**`、`scripts/**`、tests 中所有对旧表名的引用
- [x] T023 [US2] 增加迁移回归测试：新增 `packages/agent-remnote/tests/contract/store-prefix-queue-tables.contract.test.ts` 覆盖 “v1-style (txns/ops/...) → latest” 的迁移与数据保留

---

## Phase 5: User Story 3 - 自动化骨架表（可追溯持久化模型） (Priority: P3)

**Goal**: Store DB 内具备 event/trigger/task/task_run 的最小表与关联字段，为“tag 触发任务→写回子级 Rem”提供可追溯基座。  
**Independent Test**: 可写入一条 event、命中 trigger 生成 task_run，并能关联到 queue txn（或 txn.meta_json 的 task_run_id）。

- [ ] T024 [US3] 在 `packages/agent-remnote/src/internal/store/schema.sql` 增加 `event_* / trigger_* / task_*`（含 `task_runs`）骨架表
- [ ] T025 [US3] 在 `packages/agent-remnote/src/internal/store/db.ts` 增加对应 migration step（只增表/索引，forward-only）
- [ ] T026 [US3] 增加最小 DAO：新增 `packages/agent-remnote/src/internal/store/automationDao.ts`（仅包含 insert/query 的最小方法，不引入任务执行逻辑）
- [ ] T027 [US3] 增加契约测试：`packages/agent-remnote/tests/contract/store-automation-skeleton.contract.test.ts`（验证表存在、dedupe_key 唯一性、task_run ↔ txn 关联字段可写可读）

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T028 [P] SSoT 对齐：更新 `docs/ssot/agent-remnote/queue-schema.md` 为 Store DB 口径（必要时更名并更新引用）
- [x] T029 [P] 目录结构裁决同步：若引入 `internal/store/**`，同步更新 `docs/ssot/01-directory-structure.md` 的 code anchors
- [x] T030 运行 `specs/017-queue-db-generalize/quickstart.md` 的验收清单并把 evidence 写入 `specs/017-queue-db-generalize/acceptance.md`

---

## Dependencies & Execution Order

- Phase 2（Foundational）阻塞所有 user stories：必须先完成迁移 owner 与 DB 打开/迁移框架。
- US1（P1）优先：先让“store 路径/配置入口 + legacy 文件迁移”跑通。
- US2（P2）依赖 US1：表重命名与 schema 版本 bump 必须在 store owner 稳定后推进。
- US3（P3）依赖 US2（推荐）：避免骨架表与队列表命名空间互相牵制。
