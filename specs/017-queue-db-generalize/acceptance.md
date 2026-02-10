# Acceptance Evidence: 017-queue-db-generalize

**Updated**: 2026-01-29  
**Scope**: US1 + US2（`queue.sqlite` → `store.sqlite` 口径统一 + 内建迁移 + legacy 文件迁移 + 队列表 `queue_*` 命名空间）  

## Automated evidence (recommended)

- `npm test --workspace agent-remnote`
  - Covers:
    - `legacy --queue-db` flag alias
    - legacy `queue.sqlite` → default `store.sqlite` non-destructive initialization
    - `store_migrations` audit + checksum drift fail-fast
    - migration lock waiting behavior (sqlite write lock)
    - legacy table names (`txns/ops/...`) → `queue_*` prefix migration + data preservation

## Manual spot-check (optional, isolated via temp HOME)

> 目标：不污染真实 HOME；所有文件落在临时目录下。

```bash
TMP="$(mktemp -d)"
export HOME="$TMP"
node packages/agent-remnote/cli.js --json config print | jq -r '.data.store_db'
```

### 1) 默认路径创建 `store.sqlite`

```bash
node packages/agent-remnote/cli.js --json apply --no-notify --no-ensure-daemon \
  --payload '[{"type":"delete_rem","payload":{"remId":"dummy"}}]'
ls -la "$HOME/.agent-remnote/store.sqlite"
```

### 2) legacy `queue.sqlite` → `store.sqlite`（non-destructive）

```bash
rm -f "$HOME/.agent-remnote/store.sqlite"

# simulate legacy file existing at queue.sqlite
node packages/agent-remnote/cli.js --json --store-db "$HOME/.agent-remnote/queue.sqlite" apply --no-notify --no-ensure-daemon \
  --payload '[{"type":"delete_rem","payload":{"remId":"dummy"}}]'

# now open default store target: should generate store.sqlite without touching queue.sqlite
node packages/agent-remnote/cli.js --json apply --no-notify --no-ensure-daemon \
  --payload '[{"type":"delete_rem","payload":{"remId":"dummy"}}]'

ls -la "$HOME/.agent-remnote/queue.sqlite" "$HOME/.agent-remnote/store.sqlite"
```

### 3) legacy flag alias `--queue-db`（不出现在 help/README，但允许作为 fallback）

```bash
node packages/agent-remnote/cli.js --json --queue-db "$HOME/.agent-remnote/custom.sqlite" config print | jq -r '.data.store_db'
```

### 4) 表命名空间为 `queue_*`

```bash
sqlite3 "$HOME/.agent-remnote/store.sqlite" "select name from sqlite_master where type='table' order by name;" | rg '^queue_' | head
```
