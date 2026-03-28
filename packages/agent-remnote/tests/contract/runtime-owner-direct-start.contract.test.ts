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

describe('cli contract: runtime owner direct canonical starts', () => {
  it('refuses source-tree daemon start on canonical ws url while stable claim is active', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-daemon-direct-'));
    const tmpHome = path.join(tmpDir, 'home');

    try {
      await fs.mkdir(tmpHome, { recursive: true });
      const res = await runCli(['--json', '--daemon-url', 'ws://localhost:6789/ws', 'daemon', 'start'], {
        env: { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(2);
      expect(res.stderr).toBe('');
      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe('INVALID_ARGS');
      expect(String(parsed.error.message)).toContain('canonical');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('refuses source-tree plugin start on canonical port while stable claim is active', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-plugin-direct-'));
    const tmpHome = path.join(tmpDir, 'home');

    try {
      await fs.mkdir(tmpHome, { recursive: true });
      const res = await runCli(['--json', 'plugin', 'start', '--port', '8080'], {
        env: { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(2);
      expect(res.stderr).toBe('');
      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe('INVALID_ARGS');
      expect(String(parsed.error.message)).toContain('canonical');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('refuses source-tree api start on canonical port while stable claim is active', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-api-direct-'));
    const tmpHome = path.join(tmpDir, 'home');

    try {
      await fs.mkdir(tmpHome, { recursive: true });
      const res = await runCli(['--json', 'api', 'start', '--port', '3000'], {
        env: { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0', REMNOTE_STORE_DB: path.join(tmpDir, 'store.sqlite') },
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(2);
      expect(res.stderr).toBe('');
      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe('INVALID_ARGS');
      expect(String(parsed.error.message)).toContain('canonical');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
