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

describe('cli contract: idempotency-key dedupe', () => {
  it('reuses an existing txn when idempotency-key already exists', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const idem = 'test-idempotency-key-dedupe';
      const baseArgs = [
        '--json',
        'import',
        'markdown',
        '--parent',
        'dummy-parent',
        '--markdown',
        '# hi',
        '--no-notify',
        '--no-ensure-daemon',
        '--idempotency-key',
        idem,
      ] as const;

      const res1 = await runCli(baseArgs, {
        env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' },
      });
      expect(res1.exitCode).toBe(0);
      expect(res1.stderr).toBe('');

      const env1 = parseJsonLine(res1.stdout);
      expect(env1.ok).toBe(true);
      const txnId1 = String(env1.data?.txn_id ?? '');
      expect(txnId1).toMatch(/[0-9a-f-]{36}/);

      const res2 = await runCli(baseArgs, {
        env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' },
      });
      expect(res2.exitCode).toBe(0);
      expect(res2.stderr).toBe('');

      const env2 = parseJsonLine(res2.stdout);
      expect(env2.ok).toBe(true);
      expect(String(env2.data?.txn_id ?? '')).toBe(txnId1);
      expect(env2.data?.deduped).toBe(true);
      expect(Array.isArray(env2.data?.warnings)).toBe(true);
      expect(String(env2.data?.warnings?.join(' '))).toContain('Idempotency key matched an existing transaction');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
