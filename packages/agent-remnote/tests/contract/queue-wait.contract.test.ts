import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('cli contract: queue wait', () => {
  it('times out with a stable error.code in --json mode', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const writeRes = await runCli(
        ['--json', 'rem', 'create', '--parent', 'dummy-parent', '--text', 'hello', '--no-notify', '--no-ensure-daemon'],
        { env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' } },
      );

      expect(writeRes.exitCode).toBe(0);
      expect(writeRes.stderr).toBe('');

      const writeEnv = parseJsonLine(writeRes.stdout);
      expect(writeEnv.ok).toBe(true);
      const txnId = String(writeEnv.data?.txn_id ?? '');
      expect(txnId).toMatch(/[0-9a-f-]{36}/);

      const waitRes = await runCli(
        ['--json', 'queue', 'wait', '--txn', txnId, '--timeout-ms', '50', '--poll-ms', '10'],
        { env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 15_000 },
      );

      expect(waitRes.exitCode).toBe(1);
      expect(waitRes.stderr).toBe('');

      const waitEnv = parseJsonLine(waitRes.stdout);
      expect(waitEnv.ok).toBe(false);
      expect(waitEnv.error?.code).toBe('TXN_TIMEOUT');
      expect(Array.isArray(waitEnv.hint)).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 30_000);
});
