# CLI Contract: Store DB (Config + Migration)

目标：用户侧把本地持久化 DB 统一为 “Store DB”，并提供可诊断、可行动的迁移行为。

> 用户可见输出（错误信息/提示）必须英文；本合同中的示例消息也用英文。

## Config surface

### Flags / Env

- Flag: `--store-db <path>`
- Env: `REMNOTE_STORE_DB` / `STORE_DB`

> 旧入口（`--queue-db` / `REMNOTE_QUEUE_DB` / `QUEUE_DB`）允许作为 fallback，但不得继续出现在 help/README/SSoT。

### Defaults

- Default store path: `~/.agent-remnote/store.sqlite`

## Migration behavior

### File migration (legacy `queue.sqlite`)

When `store.sqlite` does not exist and `queue.sqlite` exists:

- MUST create `store.sqlite` without modifying legacy files
- MUST end up with a usable store DB that can continue enqueue/dispatch/ack

When both files exist and user does not specify `--store-db`:

- MUST use `store.sqlite` by default
- MUST NOT silently merge two DBs
- If risk is detected, MUST fail-fast with actionable next actions

### Schema migration (forward-only)

- MUST use `PRAGMA user_version` to manage schema evolution
- If DB schema is newer than CLI: fail-fast
- If migration target is unknown: fail-fast
- MUST record applied migrations in `store_migrations` (or equivalent) and detect checksum drift (fail-fast)

## Error contract (examples)

### Store DB not writable

- `error.code`: `STORE_DB_NOT_WRITABLE`
- `error.message`: `"Store database path is not writable"`
- `details.db_path`: `"..."`
- `nextActions[]` (English), e.g.:
  - `"agent-remnote config print"`
  - `"export REMNOTE_STORE_DB=~/tmp/store.sqlite"`

### Schema newer than CLI

- `error.code`: `STORE_SCHEMA_NEWER`
- `error.message`: `"Store database schema is newer than this CLI"`
- `details.current_version`, `details.supported_version`
- `nextActions[]`: `"Upgrade \`agent-remnote\` to a newer version"`

### Migration drift detected (checksum mismatch)

- `error.code`: `STORE_MIGRATION_DRIFT`
- `error.message`: `"Store database migrations do not match this CLI"`
- `details.version`, `details.expected_checksum`, `details.detected_checksum`
- `nextActions[]`:
  - `"Upgrade \`agent-remnote\` to a newer version"`
  - `"If you modified local files, reinstall from a clean release build"`

### Store DB locked

- `error.code`: `STORE_DB_LOCKED`
- `error.message`: `"Store database is locked"`
- `details.db_path`
- `nextActions[]`:
  - `"Stop other running agent-remnote processes and retry"`
  - `"Override the store db path with --store-db (or set REMNOTE_STORE_DB)"`
