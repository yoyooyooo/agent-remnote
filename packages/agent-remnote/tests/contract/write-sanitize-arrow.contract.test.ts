import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: sanitize queued write payloads', () => {
  it('replaces “→” with “=>” before enqueue', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const storePath = path.join(tmpDir, 'store.sqlite');

    try {
      const res = await runCli(['--json', 'rem', 'create', '--parent', 'P', '--text', 'push dirty → effect pull'], {
        env: { REMNOTE_STORE_DB: storePath },
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);

      const txnId = String(parsed.data.txn_id);

      const db = new BetterSqlite3(storePath);
      try {
        const row = db
          .prepare(`SELECT payload_json FROM queue_ops WHERE txn_id=? ORDER BY op_seq ASC LIMIT 1`)
          .get(txnId) as any;
        expect(row).toBeTruthy();

        const payload = JSON.parse(String(row.payload_json));
        expect(payload.text).toBe('push dirty => effect pull');
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
