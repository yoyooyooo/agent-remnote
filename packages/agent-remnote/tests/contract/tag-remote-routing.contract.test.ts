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

async function withIsolatedHome(fn: (params: { home: string; storeDb: string }) => Promise<void>): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-tag-remote-'));
  const home = path.join(tmpDir, 'home');
  const storeDb = path.join(tmpDir, 'store.sqlite');

  try {
    await fs.mkdir(home, { recursive: true });
    await fn({ home, storeDb });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe('contract: tag remote routing', () => {
  it.each([
    {
      label: 'tag add',
      args: ['tag', 'add', '--tag', 'T1', '--to', 'R1'],
    },
    {
      label: 'tag remove',
      args: ['tag', 'remove', '--tag', 'T1', '--to', 'R1'],
    },
  ])('$label uses Host API instead of silently enqueuing locally when apiBaseUrl is configured', async ({ args }) => {
    await withIsolatedHome(async ({ home, storeDb }) => {
      const res = await runCli(['--json', '--api-base-url', 'http://127.0.0.1:1', '--store-db', storeDb, ...args], {
        env: { HOME: home, REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(false);
      expect(env.error?.code).toBe('API_UNAVAILABLE');
    });
  });
});
