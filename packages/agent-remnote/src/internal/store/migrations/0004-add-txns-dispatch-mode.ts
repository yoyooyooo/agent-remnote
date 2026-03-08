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
  version: 4,
  name: 'add_txns_dispatch_mode',
  checksumInput: `ALTER TABLE txns ADD COLUMN dispatch_mode TEXT NOT NULL DEFAULT 'serial'`,
  apply: (db: StoreDB) => {
    if (!columnExists(db, 'txns', 'dispatch_mode')) {
      db.exec(`ALTER TABLE txns ADD COLUMN dispatch_mode TEXT NOT NULL DEFAULT 'serial'`);
    }
  },
} as const;
