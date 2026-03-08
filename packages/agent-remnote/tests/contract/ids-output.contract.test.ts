import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: --ids output', () => {
  it('prints ids one per line', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const payload = '[{"type":"create_rem","payload":{"parentId":"dummy-parent","text":"hello"}}]';
      const res = await runCli(['--ids', 'apply', '--no-notify', '--no-ensure-daemon', '--payload', payload], {
        env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb },
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const lines = res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      expect(lines.length).toBe(2);
      expect(lines[0].length).toBeGreaterThan(10);
      expect(lines[1].length).toBeGreaterThan(10);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
