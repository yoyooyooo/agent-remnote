-- PRAGMAs
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS store_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  checksum    TEXT NOT NULL,
  applied_at  INTEGER NOT NULL,
  app_version TEXT NOT NULL DEFAULT 'unknown'
);

CREATE TABLE IF NOT EXISTS queue_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS queue_txns (
  txn_id           TEXT PRIMARY KEY,
  status           TEXT NOT NULL CHECK (status IN ('pending','ready','in_progress','succeeded','failed','aborted')),
  dispatch_mode    TEXT NOT NULL DEFAULT 'serial' CHECK (dispatch_mode IN ('serial','conflict_parallel')),
  priority         INTEGER NOT NULL DEFAULT 0,
  idempotency_key  TEXT UNIQUE,
  client_id        TEXT,
  meta_json        TEXT NOT NULL DEFAULT '{}',
  op_count         INTEGER NOT NULL DEFAULT 0,
  next_seq         INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  committed_at     INTEGER,
  finished_at      INTEGER
);

CREATE TABLE IF NOT EXISTS queue_ops (
  op_id            TEXT PRIMARY KEY,
  txn_id           TEXT NOT NULL,
  op_seq           INTEGER NOT NULL,
  type             TEXT NOT NULL,
  payload_json     TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('pending','in_flight','succeeded','failed','dead')),
  idempotency_key  TEXT,
  op_hash          TEXT NOT NULL,
  attempt_id       TEXT,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 10,
  deliver_after    INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  INTEGER NOT NULL,
  locked_by        TEXT,
  locked_at        INTEGER,
  lease_expires_at INTEGER,
  dead_reason      TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  CONSTRAINT fk_ops_txn FOREIGN KEY (txn_id) REFERENCES queue_txns(txn_id) ON DELETE CASCADE,
  CONSTRAINT uq_txn_seq UNIQUE (txn_id, op_seq)
);

CREATE INDEX IF NOT EXISTS idx_ops_status_next ON queue_ops(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_ops_locked_by ON queue_ops(locked_by);
CREATE INDEX IF NOT EXISTS idx_ops_hash ON queue_ops(op_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_idem ON queue_ops(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS queue_op_dependencies (
  op_id             TEXT NOT NULL,
  depends_on_op_id  TEXT NOT NULL,
  PRIMARY KEY (op_id, depends_on_op_id),
  FOREIGN KEY (op_id) REFERENCES queue_ops(op_id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_op_id) REFERENCES queue_ops(op_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS queue_op_results (
  op_id         TEXT PRIMARY KEY,
  result_json   TEXT,
  error_code    TEXT,
  error_message TEXT,
  finished_at   INTEGER,
  FOREIGN KEY (op_id) REFERENCES queue_ops(op_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS queue_op_attempts (
  op_id       TEXT NOT NULL,
  attempt_id  TEXT NOT NULL,
  conn_id     TEXT,
  status      TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (op_id, attempt_id),
  FOREIGN KEY (op_id) REFERENCES queue_ops(op_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS queue_id_map (
  client_temp_id  TEXT PRIMARY KEY,
  remote_id       TEXT,
  remote_type     TEXT,
  source_txn      TEXT,
  updated_at      INTEGER
);

CREATE TABLE IF NOT EXISTS queue_consumers (
  consumer_id   TEXT PRIMARY KEY,
  last_seen_at  INTEGER NOT NULL,
  meta_json     TEXT NOT NULL DEFAULT '{}'
);
