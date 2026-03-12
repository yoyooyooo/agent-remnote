import type { StoreDB } from '../db.js';

const WORKSPACE_BINDINGS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS workspace_bindings (
  workspace_id      TEXT PRIMARY KEY,
  kb_name           TEXT,
  db_path           TEXT NOT NULL,
  source            TEXT NOT NULL CHECK (source IN ('explicit','live_ui_context','single_candidate_auto','deep_link')),
  is_current        INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  first_seen_at     INTEGER NOT NULL,
  last_verified_at  INTEGER NOT NULL,
  last_ui_context_at INTEGER,
  updated_at        INTEGER NOT NULL
);`;

const WORKSPACE_BINDINGS_CURRENT_INDEX_SQL =
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_bindings_current ON workspace_bindings(is_current) WHERE is_current = 1;`;

const WORKSPACE_BINDINGS_UPDATED_AT_INDEX_SQL =
  `CREATE INDEX IF NOT EXISTS idx_workspace_bindings_updated_at ON workspace_bindings(updated_at DESC);`;

const WORKSPACE_BINDINGS_MIGRATION_SQL = [
  WORKSPACE_BINDINGS_TABLE_SQL,
  WORKSPACE_BINDINGS_CURRENT_INDEX_SQL,
  WORKSPACE_BINDINGS_UPDATED_AT_INDEX_SQL,
] as const;

export const migration = {
  version: 6,
  name: 'add_workspace_bindings',
  checksumInput: WORKSPACE_BINDINGS_MIGRATION_SQL.join('\n'),
  apply: (db: StoreDB) => {
    db.exec(WORKSPACE_BINDINGS_MIGRATION_SQL.join('\n'));
  },
} as const;
