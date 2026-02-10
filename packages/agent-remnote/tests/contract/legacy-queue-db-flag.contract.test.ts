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

describe('cli contract: legacy --queue-db flag', () => {
  it('is accepted as an alias for --store-db', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-legacy-queue-db-flag-'));
    const tmpHome = path.join(tmpDir, 'home');
    const dbPath = path.join(tmpDir, 'custom.sqlite');

    try {
      const res = await runCli(['--json', '--queue-db', dbPath, 'config', 'print'], { env: { HOME: tmpHome } });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);
      expect(String(env.data?.store_db ?? '')).toBe(path.normalize(dbPath));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

