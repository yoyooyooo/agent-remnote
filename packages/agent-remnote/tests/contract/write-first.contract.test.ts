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

describe('cli contract: write-first workflow', () => {
  it('write commands return nextActions in --json mode', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const res = await runCli(
        [
          '--json',
          'import',
          'markdown',
          '--parent',
          'dummy-parent',
          '--markdown',
          '# hi',
          '--no-notify',
          '--no-ensure-daemon',
        ],
        {
          env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' },
        },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const envelope = parseJsonLine(res.stdout);
      expect(envelope.ok).toBe(true);

      const data = envelope.data as any;
      expect(typeof data.txn_id).toBe('string');
      expect(Array.isArray(data.op_ids)).toBe(true);
      expect(data.op_ids.length).toBeGreaterThan(0);
      expect(data.notified).toBe(false);

      expect(Array.isArray(data.nextActions)).toBe(true);
      expect(data.nextActions).toContain(`agent-remnote queue inspect --txn ${data.txn_id}`);
      expect(data.nextActions).toContain(`agent-remnote queue progress --txn ${data.txn_id}`);
      expect(data.nextActions).toContain('agent-remnote daemon sync');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('write validation failures return stable error.code + hint in --json mode', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const payload = '[{"type":"create_rem","payload":{"text":"hello"}}]';
      const res = await runCli(['--json', 'apply', '--no-notify', '--no-ensure-daemon', '--payload', payload], {
        env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' },
      });

      expect(res.exitCode).toBe(2);
      expect(res.stderr).toBe('');

      const envelope = parseJsonLine(res.stdout);
      expect(envelope.ok).toBe(false);
      expect(envelope.error?.code).toBe('INVALID_PAYLOAD');
      expect(Array.isArray(envelope.hint)).toBe(true);
      expect(envelope.hint.some((h: string) => h.includes('parentId'))).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
