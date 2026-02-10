# Research Notes: 017-queue-db-generalize

本文件记录 017 的现状盘点与关键裁决（尤其是“迁移机制应该放哪里”）。

## Current state (observed)

- 默认队列 DB 路径：
  - `packages/agent-remnote/src/services/Config.ts`：`~/.agent-remnote/queue.sqlite`
  - `packages/agent-remnote/src/internal/queue/db.ts`：`defaultQueuePath()` 读取 `REMNOTE_QUEUE_DB/QUEUE_DB`，默认 `~/.agent-remnote/queue.sqlite`
- Schema 与迁移机制已存在（不是从零开始）：
  - `packages/agent-remnote/src/internal/queue/schema.sql`：最新 DDL（包含 PRAGMAs）
  - `packages/agent-remnote/src/internal/queue/db.ts`：`PRAGMA user_version` + `LATEST_USER_VERSION` + `applyMigration()`（forward-only, fail-fast）
- 文档与全局约定普遍使用 `queue.sqlite` 口径（需统一为 store）：`AGENTS.md`、`README.md`、`docs/ssot/agent-remnote/queue-schema.md`、`docs/ssot/agent-remnote/ui-context-and-persistence.md` 等。

## Key decision: migrations owner（迁移逻辑放哪里）

**Decision**: 迁移逻辑必须放在“打开 DB 的唯一模块”中，并且任何使用 DB 的入口（CLI/daemon）都必须通过它打开 DB。

- 现状 owner：`packages/agent-remnote/src/internal/queue/db.ts`（已具备 user_version 机制）
- 017 落地后 owner：仍以该模块为唯一入口（可在后续重构中迁移到 `packages/agent-remnote/src/internal/store/**`，但 owner 语义不变）

**Rationale**:

- 避免多个入口各自迁移造成漂移（尤其是 CLI 与 daemon 并行演进）。
- 迁移与 schema 的“裁决点”必须唯一，否则难以保证 forward-only 与可诊断性。

**Alternatives considered**:

- “单独放在 scripts/ 里让用户手工跑 SQL”：拒绝。发包后不可控、难验证、难回滚，且违反 write-first 的可行动诊断原则。
- “每个命令按需迁移”：拒绝。会出现部分命令升级、部分命令未升级的分裂状态。

## File-level migration risk: WAL / -wal / -shm

队列 DB 默认 `journal_mode=WAL`。如果仅用文件复制（copy main db file）来生成 `store.sqlite`，可能遗漏 `queue.sqlite-wal` 中未 checkpoint 的内容，导致“看似迁移成功但数据丢失”。

**Decision**: 生成 `store.sqlite` 时优先使用 SQLite 的一致性拷贝能力（backup API / VACUUM INTO / attach+copy），而不是裸文件复制。

**Rationale**: 保证迁移过程在 WAL 模式下也可得到一致快照，避免隐性丢数据。

## Reuse candidates

- 迁移机制：直接复用并扩展 `queue/db.ts` 的 `readUserVersion/setUserVersion/applyMigration()` 模式。
- Schema canonical：保留 `schema.sql` 为事实源，同时保留 bundling fallback snapshot（现有模式已解决 `bun build` flatten 路径问题）。
- 配置与路径解析：继续复用 `resolveUserFilePath()` 的 `~` 展开与 `normalize` 逻辑（Constitution #6）。
