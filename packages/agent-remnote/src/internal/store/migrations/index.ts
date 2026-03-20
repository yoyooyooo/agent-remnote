import { migration as m0001 } from './0001-baseline.js';
import { migration as m0002 } from './0002-add-ops-attempt-id.js';
import { migration as m0003 } from './0003-add-op-attempts-table.js';
import { migration as m0004 } from './0004-add-txns-dispatch-mode.js';
import { migration as m0005 } from './0005-prefix-queue-tables.js';
import { migration as m0006 } from './0006-add-workspace-bindings.js';
import { migration as m0008 } from './0008-add-automation-skeleton.js';
import { migration as m0009 } from './0009-add-task-run-fk-indexes.js';
import type { StoreDB } from '../db.js';

export type MigrationSpec = {
  readonly version: number;
  readonly name: string;
  readonly checksumInput: string;
  readonly apply: (db: import('../db.js').StoreDB) => void;
};

const BACKUP_ARTIFACTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS backup_artifacts (
  source_op_id      TEXT PRIMARY KEY,
  source_txn        TEXT NOT NULL,
  source_op_type    TEXT NOT NULL CHECK (source_op_type IN ('replace_children_with_markdown','replace_selection_with_markdown')),
  backup_kind       TEXT NOT NULL CHECK (backup_kind IN ('children_replace','selection_replace')),
  cleanup_policy    TEXT NOT NULL CHECK (cleanup_policy IN ('auto','visible')),
  cleanup_state     TEXT NOT NULL CHECK (cleanup_state IN ('pending','orphan','retained','cleaned')),
  backup_rem_id     TEXT,
  source_parent_id  TEXT,
  source_anchor_id  TEXT,
  result_json       TEXT NOT NULL DEFAULT '{}',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  cleaned_at        INTEGER
);`;

const IDX_BACKUP_ARTIFACTS_STATE_SQL =
  `CREATE INDEX IF NOT EXISTS idx_backup_artifacts_state ON backup_artifacts(cleanup_state, updated_at DESC);`;
const IDX_BACKUP_ARTIFACTS_KIND_SQL =
  `CREATE INDEX IF NOT EXISTS idx_backup_artifacts_kind ON backup_artifacts(backup_kind, updated_at DESC);`;
const UQ_BACKUP_ARTIFACTS_REM_SQL =
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_backup_artifacts_backup_rem_id ON backup_artifacts(backup_rem_id) WHERE backup_rem_id IS NOT NULL;`;

const m0007: MigrationSpec = {
  version: 7,
  name: 'add_backup_artifacts',
  checksumInput: [BACKUP_ARTIFACTS_TABLE_SQL, IDX_BACKUP_ARTIFACTS_STATE_SQL, IDX_BACKUP_ARTIFACTS_KIND_SQL, UQ_BACKUP_ARTIFACTS_REM_SQL].join(
    '\n',
  ),
  apply: (db: StoreDB) => {
    db.exec(BACKUP_ARTIFACTS_TABLE_SQL);
    db.exec(IDX_BACKUP_ARTIFACTS_STATE_SQL);
    db.exec(IDX_BACKUP_ARTIFACTS_KIND_SQL);
    db.exec(UQ_BACKUP_ARTIFACTS_REM_SQL);
  },
};

export const migrationSpecs: readonly MigrationSpec[] = [m0001, m0002, m0003, m0004, m0005, m0006, m0007, m0008, m0009];
