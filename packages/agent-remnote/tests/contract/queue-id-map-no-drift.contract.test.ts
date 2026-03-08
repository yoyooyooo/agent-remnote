import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { IdMapConflictError, openQueueDb, upsertIdMap } from '../../src/internal/queue/index.js';

describe('queue contract: id_map does not drift', () => {
  it('rejects a conflicting remote_id for the same client_temp_id', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-queue-id-map-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openQueueDb(dbPath);
      try {
        upsertIdMap(db, [{ client_temp_id: 'tmp-1', remote_id: 'remote-a', remote_type: 'rem', source_txn: 'txn-1' }]);
        upsertIdMap(db, [{ client_temp_id: 'tmp-1', remote_id: 'remote-a', remote_type: 'rem', source_txn: 'txn-2' }]);

        expect(() =>
          upsertIdMap(db, [
            { client_temp_id: 'tmp-1', remote_id: 'remote-b', remote_type: 'rem', source_txn: 'txn-3' },
          ]),
        ).toThrow(IdMapConflictError);

        const row = db
          .prepare(`SELECT client_temp_id, remote_id, source_txn FROM queue_id_map WHERE client_temp_id=?`)
          .get('tmp-1') as any;
        expect(String(row.client_temp_id)).toBe('tmp-1');
        expect(String(row.remote_id)).toBe('remote-a');
        expect(String(row.source_txn)).toBe('txn-1');
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
