import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: daemon status --json (supervisor mode)', () => {
  it('prints ok envelope and supervisor mode data shape even when not running', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-cli-test-'));

    try {
      const pidFile = path.join(tmpDir, 'ws.pid');
      const res = await runCli(
        ['--json', '--daemon-url', 'ws://localhost:0/ws', 'daemon', 'status', '--pid-file', pidFile],
        {
          env: { HOME: tmpDir },
        },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(typeof parsed.data.runtime?.version).toBe('string');
      expect(typeof parsed.data.runtime?.build_id).toBe('string');
      expect(parsed.data.service.mode).toBe('supervisor');
      expect(typeof parsed.data.service.supervisor).toBe('object');
      expect(parsed.data.service.supervisor.running).toBe(false);
      expect(parsed.data.service.build ?? null).toBe(null);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 15_000);
});
