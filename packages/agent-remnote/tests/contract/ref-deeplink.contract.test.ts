import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: --ref deep link', () => {
  it('accepts remnote://w/<workspaceId>/<remId> inside --at parent:<ref>', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const workspaceId = '60810ee78b0e5400347f6a8c';
      const remId = 'g76r36o9ssYJt897o';
      const deepLink = `remnote://w/${workspaceId}/${remId}`;

      const res = await runCli(['--json', 'rem', 'create', '--at', `parent:${deepLink}`, '--text', 'hello', '--dry-run'], {
        env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb },
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout) as any;
      expect(parsed.ok).toBe(true);
      expect(parsed.data?.dry_run).toBe(true);
      const payload = parsed.data?.ops?.[0]?.payload;
      expect(payload?.parentId ?? payload?.parent_id).toBe(remId);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
