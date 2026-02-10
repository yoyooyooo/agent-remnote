import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { openStoreDb } from '../../src/internal/store/index.js';
import { enqueueTxn } from '../../src/internal/queue/index.js';

describe('store contract: legacy queue.sqlite file migration', () => {
  it('initializes default store.sqlite from legacy queue.sqlite (non-destructive)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-store-legacy-migrate-'));
    const tmpHome = path.join(tmpDir, 'home');

    const prevHome = process.env.HOME;
    const prevStoreDb = process.env.REMNOTE_STORE_DB;
    const prevStoreDb2 = process.env.STORE_DB;
    const prevQueueDb = process.env.REMNOTE_QUEUE_DB;
    const prevQueueDb2 = process.env.QUEUE_DB;

    process.env.HOME = tmpHome;
    delete process.env.REMNOTE_STORE_DB;
    delete process.env.STORE_DB;
    delete process.env.REMNOTE_QUEUE_DB;
    delete process.env.QUEUE_DB;

    try {
      const legacyPath = path.join(tmpHome, '.agent-remnote', 'queue.sqlite');
      const storePath = path.join(tmpHome, '.agent-remnote', 'store.sqlite');

      await fs.rm(storePath, { force: true });
      await fs.rm(legacyPath, { force: true });

      const legacyDb = openStoreDb(legacyPath);
      let txnId = '';
      try {
        txnId = enqueueTxn(legacyDb as any, [{ type: 'delete_rem', payload: { remId: 'dummy' } }]);
        expect(typeof txnId).toBe('string');
        legacyDb.pragma('wal_checkpoint(TRUNCATE)');
      } finally {
        legacyDb.close();
      }

      expect(await fs.stat(legacyPath)).toBeTruthy();
      await expect(fs.stat(storePath)).rejects.toThrow();

      const storeDb = openStoreDb();
      try {
        const row = storeDb.prepare(`SELECT txn_id FROM queue_txns WHERE txn_id=?`).get(txnId) as any;
        expect(String(row?.txn_id ?? '')).toBe(txnId);
      } finally {
        storeDb.close();
      }

      expect(await fs.stat(storePath)).toBeTruthy();
      expect(await fs.stat(legacyPath)).toBeTruthy();
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevStoreDb === undefined) delete process.env.REMNOTE_STORE_DB;
      else process.env.REMNOTE_STORE_DB = prevStoreDb;
      if (prevStoreDb2 === undefined) delete process.env.STORE_DB;
      else process.env.STORE_DB = prevStoreDb2;
      if (prevQueueDb === undefined) delete process.env.REMNOTE_QUEUE_DB;
      else process.env.REMNOTE_QUEUE_DB = prevQueueDb;
      if (prevQueueDb2 === undefined) delete process.env.QUEUE_DB;
      else process.env.QUEUE_DB = prevQueueDb2;

      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
