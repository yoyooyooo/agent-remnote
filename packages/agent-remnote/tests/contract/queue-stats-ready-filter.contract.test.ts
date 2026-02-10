import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { enqueueTxn, openQueueDb, queueStats } from '../../src/internal/queue/index.js';

describe('queue contract: stats only counts dispatchable pending ops', () => {
  it('excludes pending ops from failed txns', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-stats-filter-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openQueueDb(dbPath);
      try {
        const readyTxn = enqueueTxn(db, [{ type: 'update_text', payload: { rem_id: 'r1', text: 'a' } }]);
        const failedTxn = enqueueTxn(db, [{ type: 'update_text', payload: { rem_id: 'r2', text: 'b' } }]);

        db.prepare(`UPDATE queue_txns SET status='failed' WHERE txn_id=?`).run(failedTxn);

        const stats = queueStats(db);
        expect(stats.pending).toBe(1);
        expect(stats.ready_txns).toBe(1);

        const pendingRows = db.prepare(`SELECT txn_id FROM queue_ops WHERE status='pending' ORDER BY txn_id`).all() as any[];
        expect(pendingRows.length).toBe(2);
        expect(pendingRows.map((r) => String(r.txn_id))).toContain(readyTxn);
        expect(pendingRows.map((r) => String(r.txn_id))).toContain(failedTxn);
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

