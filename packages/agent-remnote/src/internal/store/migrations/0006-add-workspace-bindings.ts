import type { StoreDB } from '../db.js';

export const migration = {
  version: 6,
  name: 'add_workspace_bindings',
  checksumInput: [
    `CREATE TABLE IF NOT EXISTS workspace_bindings (
  workspace_id      TEXT PRIMARY KEY,
  kb_name           TEXT,
  db_path           TEXT NOT NULL,
  source            TEXT NOT NULL CHECK (source IN ('explicit','live_ui_context','single_candidate_auto','deep_link')),
  is_current        INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  first_seen_at     INTEGER NOT NULL,
  last_verified_at  INTEGER NOT NULL,
  last_ui_context_at INTEGER,
  updated_at        INTEGER NOT NULL
)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_bindings_current ON workspace_bindings(is_current) WHERE is_current = 1`,
    `CREATE INDEX IF NOT EXISTS idx_workspace_bindings_updated_at ON workspace_bindings(updated_at DESC)`,
  ].join('\n'),
  apply: (db: StoreDB) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_bindings (
        workspace_id       TEXT PRIMARY KEY,
        kb_name            TEXT,
        db_path            TEXT NOT NULL,
        source             TEXT NOT NULL CHECK (source IN ('explicit','live_ui_context','single_candidate_auto','deep_link')),
        is_current         INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
        first_seen_at      INTEGER NOT NULL,
        last_verified_at   INTEGER NOT NULL,
        last_ui_context_at INTEGER,
        updated_at         INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_bindings_current
        ON workspace_bindings(is_current)
        WHERE is_current = 1;

      CREATE INDEX IF NOT EXISTS idx_workspace_bindings_updated_at
        ON workspace_bindings(updated_at DESC);
    `);
  },
} as const;
