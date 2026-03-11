import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { ackSuccess, claimNextOp, openQueueDb } from '../../src/internal/queue/index.js';
import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe('cli contract: write --wait', () => {
  it('can wait until the txn is completed (simulated ack)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const cliPromise = runCli(
        [
          '--json',
          'apply',
          '--payload',
          '{"version":1,"kind":"ops","ops":[{"type":"delete_rem","payload":{"rem_id":"dummy-rem"}}]}',
          '--no-notify',
          '--no-ensure-daemon',
          '--wait',
          '--timeout-ms',
          '30000',
          '--poll-ms',
          '10',
        ],
        { env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 55_000 },
      );

      const startedAt = Date.now();
      while (Date.now() - startedAt < 40_000) {
        try {
          const db = openQueueDb(storeDb);
          try {
            const claimed = claimNextOp(db as any, 'test-conn', 30_000);
            if (!claimed) {
              await sleep(20);
              continue;
            }
            const opId = String(claimed.op_id);
            const attemptId = String(claimed.attempt_id);
            ackSuccess(db as any, { opId, attemptId, lockedBy: 'test-conn', result: { ok: true } });
            break;
          } finally {
            db.close();
          }
        } catch {
          await sleep(20);
        }
      }

      const res = await cliPromise;
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);

      const data = env.data as any;
      expect(typeof data.txn_id).toBe('string');
      expect(Array.isArray(data.op_ids)).toBe(true);
      expect(data.status).toBe('succeeded');
      expect(data.is_done).toBe(true);
      expect(data.is_success).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 45_000);

  it('times out with a stable error.code in --json mode', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const res = await runCli(
        [
          '--json',
          'apply',
          '--payload',
          '{"version":1,"kind":"ops","ops":[{"type":"delete_rem","payload":{"rem_id":"dummy-rem"}}]}',
          '--no-notify',
          '--no-ensure-daemon',
          '--wait',
          '--timeout-ms',
          '50',
          '--poll-ms',
          '10',
        ],
        { env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(false);
      expect(env.error?.code).toBe('TXN_TIMEOUT');
      expect(Array.isArray(env.hint)).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
