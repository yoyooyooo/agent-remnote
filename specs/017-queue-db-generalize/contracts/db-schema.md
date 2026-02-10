# DB Contract: Store DB Schema (Namespaces + Versioning)

目标：把 schema 变更变成可控的 forward-only 演进：版本可读、迁移可重复、失败可诊断。

## Versioning

- 使用 `PRAGMA user_version` 作为 schema 版本号
- 每次变更必须：
  1) bump `LATEST_USER_VERSION`
  2) 增加对应的 migration step（transactional，建议一个版本一个文件）
  3) 更新 canonical `schema.sql`（并同步 fallback snapshot）
  4) 更新 SSoT 文档中的版本与 DDL 口径

### Migration files (recommended)

- `packages/agent-remnote/src/internal/store/migrations/*.ts`
- 约定：一个 `user_version` 对应一个 migration 文件，文件名以版本号前缀排序（例如 `0004-add-txn-dispatch-mode.ts`）

## Migration Audit (recommended)

- Store schema 应包含迁移审计表（例如 `store_migrations`），记录：
  - `version`（unique）
  - `name`
  - `checksum`（用于检测迁移漂移）
  - `applied_at`
  - `app_version`（或等价字段，记录触发迁移的 CLI/daemon 版本）
- 启动时必须校验已应用 migration 的 checksum 与当前代码一致；不一致必须 fail-fast（避免“版本号前进但迁移内容已变”的不可诊断状态）。

## Namespaces

- 写入队列所有表必须以 `queue_` 开头（避免与自动化模块冲突）
- 自动化骨架表分别使用：
  - `event_`（事实事件）
  - `trigger_`（触发规则）
  - `task_`（任务定义与运行）

## Non-destructive guarantee

- 不允许“原地改写 legacy 文件名”作为默认迁移策略
- 不允许通过 view/alias 长期保留旧表名作为兼容层（forward-only）

## Diagnostics

任何 schema 相关 fail-fast 必须包含：

- `db_path`
- `detected_version` / `expected_version`
- `nextActions[]`（英文，可复制执行）

## Concurrency

- 迁移 runner 应设置 `busy_timeout`（或等价策略），并在迁移阶段使用写锁（例如 `BEGIN IMMEDIATE`）。
- 对 “database is locked” 需要有限重试 + 退避；最终失败时必须给出英文 `nextActions[]` 指导用户排障或改用其它 db path。
