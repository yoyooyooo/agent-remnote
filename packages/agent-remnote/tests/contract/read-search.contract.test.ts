import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: read search --json', () => {
  it('prints a single json envelope and keeps stderr empty on db error', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const missingDb = path.join(tmpDir, 'missing-remnote.db');

    try {
      const res = await runCli(['--json', '--remnote-db', missingDb, 'search', '--query', 'hello']);

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe('DB_UNAVAILABLE');
      expect(String(parsed.error.message)).not.toContain('shared.js');
      expect(String(parsed.error.message)).not.toContain('Cannot find module');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
