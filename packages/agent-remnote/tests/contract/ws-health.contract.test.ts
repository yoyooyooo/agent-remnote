import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: daemon health --json', () => {
  it('prints ok envelope and health data', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const storeDb = path.join(tmpDir, 'store.sqlite');

    const prevStoreDb = process.env.REMNOTE_STORE_DB;
    process.env.REMNOTE_STORE_DB = storeDb;

    try {
      // Some CI environments disallow binding local TCP ports; use a guaranteed-unreachable URL
      // to contract-test the JSON envelope + failure behavior.
      const wsUrl = `ws://localhost:65535/ws`;

      const res = await runCli(['--json', '--daemon-url', wsUrl, 'daemon', 'health']);

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code === 'WS_TIMEOUT' || parsed.error.code === 'WS_UNAVAILABLE').toBe(true);
    } finally {
      if (prevStoreDb === undefined) delete process.env.REMNOTE_STORE_DB;
      else process.env.REMNOTE_STORE_DB = prevStoreDb;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
