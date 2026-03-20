import type { StoreDB } from '../db.js';

const TASK_DEFS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS task_defs (
  task_id      TEXT PRIMARY KEY,
  task_kind    TEXT NOT NULL,
  config_json  TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);`;

const TRIGGER_RULES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS trigger_rules (
  trigger_id    TEXT PRIMARY KEY,
  trigger_kind  TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  match_json    TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES task_defs(task_id) ON DELETE RESTRICT
);`;

const EVENT_EVENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS event_events (
  event_id        TEXT PRIMARY KEY,
  event_kind      TEXT NOT NULL,
  source_rem_id   TEXT,
  source_tag_id   TEXT,
  dedupe_key      TEXT NOT NULL UNIQUE,
  payload_json    TEXT NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL
);`;

const TASK_RUNS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS task_runs (
  run_id          TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL,
  trigger_id      TEXT,
  event_id        TEXT,
  target_rem_id   TEXT NOT NULL,
  result_rem_id   TEXT,
  queue_txn_id    TEXT,
  status          TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','aborted')),
  detail_json     TEXT NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  FOREIGN KEY (task_id) REFERENCES task_defs(task_id) ON DELETE RESTRICT,
  FOREIGN KEY (trigger_id) REFERENCES trigger_rules(trigger_id) ON DELETE SET NULL,
  FOREIGN KEY (event_id) REFERENCES event_events(event_id) ON DELETE SET NULL,
  FOREIGN KEY (queue_txn_id) REFERENCES queue_txns(txn_id) ON DELETE SET NULL
);`;

const IDX_TRIGGER_RULES_TASK_ID_SQL = `CREATE INDEX IF NOT EXISTS idx_trigger_rules_task_id ON trigger_rules(task_id);`;
const IDX_TASK_RUNS_TASK_ID_SQL = `CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id, updated_at DESC);`;
const IDX_TASK_RUNS_QUEUE_TXN_ID_SQL = `CREATE INDEX IF NOT EXISTS idx_task_runs_queue_txn_id ON task_runs(queue_txn_id);`;
const IDX_EVENT_EVENTS_SOURCE_REM_SQL = `CREATE INDEX IF NOT EXISTS idx_event_events_source_rem_id ON event_events(source_rem_id, created_at DESC);`;

const AUTOMATION_SKELETON_SQL = [
  TASK_DEFS_TABLE_SQL,
  TRIGGER_RULES_TABLE_SQL,
  EVENT_EVENTS_TABLE_SQL,
  TASK_RUNS_TABLE_SQL,
  IDX_TRIGGER_RULES_TASK_ID_SQL,
  IDX_TASK_RUNS_TASK_ID_SQL,
  IDX_TASK_RUNS_QUEUE_TXN_ID_SQL,
  IDX_EVENT_EVENTS_SOURCE_REM_SQL,
] as const;

export const migration = {
  version: 8,
  name: 'add_automation_skeleton',
  checksumInput: AUTOMATION_SKELETON_SQL.join('\n'),
  apply: (db: StoreDB) => {
    db.exec(AUTOMATION_SKELETON_SQL.join('\n'));
  },
} as const;
