# Quickstart: Store DB 通用化（验收清单草案）

## Acceptance Checklist

- [x] 默认使用 `~/.agent-remnote/store.sqlite`，且 help/README/SSoT 不再宣传 `queue.sqlite` 为默认 DB。
- [x] `--store-db` / `REMNOTE_STORE_DB` / `STORE_DB` 可覆盖默认路径，并支持 `~` 展开与 `normalize`。
- [x] 仅存在 legacy `queue.sqlite` 时，系统可 non-destructive 生成 `store.sqlite`，且 legacy 文件不被修改/删除。
- [x] Store DB schema 支持 forward-only migrations（`PRAGMA user_version`）；版本不匹配 fail-fast 并返回英文 `nextActions[]`。
- [x] 迁移审计可追溯：`store_migrations` 记录每次迁移的 `version/name/checksum/applied_at/app_version`；checksum 漂移检测 fail-fast。
- [x] 并发启动安全：并发进程同时打开 store DB 时不会产生半迁移状态（busy_timeout + 写锁 + 有限重试/退避）。
- [x] 队列相关表完成 `queue_*` 命名空间迁移，且 enqueue/dispatch/ack 全链路继续工作。
- [ ] Store DB 内存在自动化骨架表（event/trigger/task/task_runs），且 `task_run` 可追溯到写回队列 txn（或等价 link）。

> Evidence: 实现阶段在 `specs/017-queue-db-generalize/acceptance.md` 记录可复现命令与结果。
