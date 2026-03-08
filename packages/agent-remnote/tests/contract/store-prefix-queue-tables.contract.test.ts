import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';

import { openStoreDb } from '../../src/internal/store/index.js';

function tableExists(db: any, name: string): boolean {
  const row = db.prepare(`SELECT 1 as ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`).get(name) as any;
  return !!row?.ok;
}

function columnExists(db: any, table: string, column: string): boolean {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    return rows.some((r) => String(r?.name ?? '') === column);
  } catch {
    return false;
  }
}

describe('store contract: legacy queue tables are renamed to queue_*', () => {
  it('migrates a v1-style schema (txns/ops/...) into queue_* and preserves data', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-store-prefix-queue-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    try {
      const txnId = 'txn-legacy';
      const opId = 'op-legacy';
      const t = Date.now();

      const seedDb = new BetterSqlite3(dbPath);
      try {
        seedDb.exec(`
          PRAGMA foreign_keys = ON;
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous = NORMAL;
          PRAGMA user_version = 1;

          CREATE TABLE IF NOT EXISTS txns (
            txn_id           TEXT PRIMARY KEY,
            status           TEXT NOT NULL CHECK (status IN ('pending','ready','in_progress','succeeded','failed','aborted')),
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

          CREATE TABLE IF NOT EXISTS ops (
            op_id            TEXT PRIMARY KEY,
            txn_id           TEXT NOT NULL,
            op_seq           INTEGER NOT NULL,
            type             TEXT NOT NULL,
            payload_json     TEXT NOT NULL,
            status           TEXT NOT NULL CHECK (status IN ('pending','in_flight','succeeded','failed','dead')),
            idempotency_key  TEXT,
            op_hash          TEXT NOT NULL,
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
            CONSTRAINT fk_ops_txn FOREIGN KEY (txn_id) REFERENCES txns(txn_id) ON DELETE CASCADE,
            CONSTRAINT uq_txn_seq UNIQUE (txn_id, op_seq)
          );

          CREATE TABLE IF NOT EXISTS op_dependencies (
            op_id             TEXT NOT NULL,
            depends_on_op_id  TEXT NOT NULL,
            PRIMARY KEY (op_id, depends_on_op_id),
            FOREIGN KEY (op_id) REFERENCES ops(op_id) ON DELETE CASCADE,
            FOREIGN KEY (depends_on_op_id) REFERENCES ops(op_id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS op_results (
            op_id         TEXT PRIMARY KEY,
            result_json   TEXT,
            error_code    TEXT,
            error_message TEXT,
            finished_at   INTEGER,
            FOREIGN KEY (op_id) REFERENCES ops(op_id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS id_map (
            client_temp_id  TEXT PRIMARY KEY,
            remote_id       TEXT,
            remote_type     TEXT,
            source_txn      TEXT,
            updated_at      INTEGER
          );

          CREATE TABLE IF NOT EXISTS consumers (
            consumer_id   TEXT PRIMARY KEY,
            last_seen_at  INTEGER NOT NULL,
            meta_json     TEXT NOT NULL DEFAULT '{}'
          );
        `);

        seedDb
          .prepare(
            `INSERT INTO txns(txn_id, status, priority, idempotency_key, client_id, meta_json, op_count, next_seq, created_at, updated_at, committed_at, finished_at)
           VALUES(@txn_id, 'ready', 0, NULL, NULL, '{}', 1, 1, @t, @t, @t, NULL)`,
          )
          .run({ txn_id: txnId, t });

        seedDb
          .prepare(
            `INSERT INTO ops(op_id, txn_id, op_seq, type, payload_json, status, idempotency_key, op_hash, attempt_count, max_attempts, deliver_after, next_attempt_at, locked_by, locked_at, lease_expires_at, dead_reason, created_at, updated_at)
           VALUES(@op_id, @txn_id, 1, 'update_text', '{}', 'pending', NULL, 'hash', 0, 10, 0, @t, NULL, NULL, NULL, NULL, @t, @t)`,
          )
          .run({ op_id: opId, txn_id: txnId, t });

        seedDb.pragma('wal_checkpoint(TRUNCATE)');
      } finally {
        seedDb.close();
      }

      const db = openStoreDb(dbPath);
      try {
        expect(tableExists(db, 'queue_txns')).toBe(true);
        expect(tableExists(db, 'queue_ops')).toBe(true);
        expect(tableExists(db, 'queue_op_attempts')).toBe(true);
        expect(tableExists(db, 'queue_op_results')).toBe(true);
        expect(tableExists(db, 'queue_op_dependencies')).toBe(true);
        expect(tableExists(db, 'queue_id_map')).toBe(true);
        expect(tableExists(db, 'queue_consumers')).toBe(true);

        expect(tableExists(db, 'txns')).toBe(false);
        expect(tableExists(db, 'ops')).toBe(false);
        expect(tableExists(db, 'op_attempts')).toBe(false);
        expect(tableExists(db, 'op_results')).toBe(false);
        expect(tableExists(db, 'op_dependencies')).toBe(false);
        expect(tableExists(db, 'id_map')).toBe(false);
        expect(tableExists(db, 'consumers')).toBe(false);

        expect(columnExists(db, 'queue_txns', 'dispatch_mode')).toBe(true);
        expect(columnExists(db, 'queue_ops', 'attempt_id')).toBe(true);

        const txnRow = db.prepare(`SELECT txn_id FROM queue_txns WHERE txn_id=?`).get(txnId) as any;
        expect(String(txnRow?.txn_id ?? '')).toBe(txnId);

        const opRow = db.prepare(`SELECT op_id, txn_id FROM queue_ops WHERE op_id=?`).get(opId) as any;
        expect(String(opRow?.op_id ?? '')).toBe(opId);
        expect(String(opRow?.txn_id ?? '')).toBe(txnId);
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
