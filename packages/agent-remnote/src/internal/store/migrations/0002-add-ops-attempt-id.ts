import type { StoreDB } from '../db.js';

function columnExists(db: StoreDB, table: string, column: string): boolean {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    return rows.some((r) => String(r?.name) === column);
  } catch {
    return false;
  }
}

export const migration = {
  version: 2,
  name: 'add_ops_attempt_id',
  checksumInput: `ALTER TABLE ops ADD COLUMN attempt_id TEXT`,
  apply: (db: StoreDB) => {
    if (!columnExists(db, 'ops', 'attempt_id')) {
      db.exec(`ALTER TABLE ops ADD COLUMN attempt_id TEXT`);
    }
  },
} as const;

