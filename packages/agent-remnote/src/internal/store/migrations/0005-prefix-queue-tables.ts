import type { StoreDB } from '../db.js';

function tableExists(db: StoreDB, name: string): boolean {
  try {
    const row = db
      .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type='table' AND name=@name LIMIT 1`)
      .get({ name }) as any;
    return !!row?.ok;
  } catch {
    return false;
  }
}

function renameTable(db: StoreDB, from: string, to: string): void {
  const fromExists = tableExists(db, from);
  if (!fromExists) return;

  const toExists = tableExists(db, to);
  if (toExists) {
    throw new Error(`Store migration conflict: both '${from}' and '${to}' exist`);
  }

  db.exec(`ALTER TABLE "${from}" RENAME TO "${to}"`);
}

export const migration = {
  version: 5,
  name: 'prefix_queue_tables',
  checksumInput: [
    `ALTER TABLE txns RENAME TO queue_txns`,
    `ALTER TABLE ops RENAME TO queue_ops`,
    `ALTER TABLE op_dependencies RENAME TO queue_op_dependencies`,
    `ALTER TABLE op_results RENAME TO queue_op_results`,
    `ALTER TABLE op_attempts RENAME TO queue_op_attempts`,
    `ALTER TABLE id_map RENAME TO queue_id_map`,
    `ALTER TABLE consumers RENAME TO queue_consumers`,
  ].join('\n'),
  apply: (db: StoreDB) => {
    renameTable(db, 'txns', 'queue_txns');
    renameTable(db, 'ops', 'queue_ops');
    renameTable(db, 'op_dependencies', 'queue_op_dependencies');
    renameTable(db, 'op_results', 'queue_op_results');
    renameTable(db, 'op_attempts', 'queue_op_attempts');
    renameTable(db, 'id_map', 'queue_id_map');
    renameTable(db, 'consumers', 'queue_consumers');
  },
} as const;

