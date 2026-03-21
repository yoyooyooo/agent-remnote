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

describe('cli contract: write failures are diagnosable', () => {
  it('invalid --at placement spec is rejected with a stable error.code + hint', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'create',
      '--at',
      'parent:',
      '--text',
      'hello',
      '--no-notify',
      '--no-ensure-daemon',
    ]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INVALID_ARGS');
    expect(Array.isArray(env.hint)).toBe(true);
    expect(env.hint.some((h: string) => String(h).includes('Examples: --at parent:id:P1'))).toBe(true);
  });

  it('daemon unreachable still enqueues and returns actionable warnings/nextActions', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const payload = JSON.stringify({ version: 1, kind: 'ops', ops: [{ type: 'delete_rem', payload: { remId: 'dummy' } }] });

      const res = await runCli(['--json', 'apply', '--payload', payload, '--no-ensure-daemon'], {
        env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, DAEMON_URL: 'ws://127.0.0.1:1/ws', REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);

      const data = env.data as any;
      expect(data.notified).toBe(false);
      expect(Array.isArray(data.warnings)).toBe(true);
      expect(String(data.warnings.join(' '))).toContain('failed to trigger sync');
      expect(Array.isArray(data.nextActions)).toBe(true);
      expect(data.nextActions).toContain('agent-remnote daemon ensure');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('invalid payload shape is rejected with a stable error.code', async () => {
    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', '{"foo":1}']);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INVALID_PAYLOAD');
  });
});
