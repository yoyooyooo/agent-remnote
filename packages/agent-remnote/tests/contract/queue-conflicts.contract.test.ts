import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { enqueueTxn, openQueueDb } from '../../src/internal/queue/index.js';
import { runCli } from '../helpers/runCli.js';

describe('cli contract: queue conflicts --json', () => {
  it('prints a single json envelope and keeps stderr empty', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-queue-conflicts-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openQueueDb(dbPath);
      try {
        enqueueTxn(db as any, [{ type: 'update_text', payload: { remId: 'A', text: '1' } }]);
        enqueueTxn(db as any, [{ type: 'delete_rem', payload: { remId: 'A' } }]);
        enqueueTxn(db as any, [{ type: 'update_text', payload: { remId: 'B', text: '2' } }]);
      } finally {
        db.close();
      }

      const res = await runCli([
        '--json',
        '--store-db',
        dbPath,
        'queue',
        'conflicts',
        '--limit',
        '100',
        '--max-clusters',
        '50',
        '--top',
        '5',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const lines = res.stdout.trim().split('\n');
      expect(lines.length).toBe(1);
      const env = JSON.parse(lines[0] ?? '{}');
      expect(env.ok).toBe(true);

      const data = env.data as any;
      expect(typeof data.scanned_ops).toBe('number');
      expect(Array.isArray(data.clusters)).toBe(true);

      // delete + update on the same rem should be reported as a high-risk cluster.
      const high = (data.clusters as any[]).find((c) => c?.risk === 'high');
      expect(high).toBeTruthy();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
