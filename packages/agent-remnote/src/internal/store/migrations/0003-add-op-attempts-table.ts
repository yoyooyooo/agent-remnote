import type { StoreDB } from '../db.js';

export const migration = {
  version: 3,
  name: 'add_op_attempts_table',
  checksumInput: `CREATE TABLE IF NOT EXISTS op_attempts(...)`,
  apply: (db: StoreDB) => {
    db.exec(`CREATE TABLE IF NOT EXISTS op_attempts (
      op_id       TEXT NOT NULL,
      attempt_id  TEXT NOT NULL,
      conn_id     TEXT,
      status      TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (op_id, attempt_id),
      FOREIGN KEY (op_id) REFERENCES ops(op_id) ON DELETE CASCADE
    )`);
  },
} as const;
