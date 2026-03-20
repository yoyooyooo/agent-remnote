import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: stack status version warnings', () => {
  it('reports build mismatch warnings from pid metadata in json mode', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-stack-status-'));
    const tmpHome = path.join(tmpDir, 'home');
    const daemonDir = path.join(tmpHome, '.agent-remnote');
    const wsPid = path.join(daemonDir, 'ws.pid');
    const apiPid = path.join(daemonDir, 'api.pid');

    try {
      await fs.mkdir(daemonDir, { recursive: true });
      await fs.writeFile(
        wsPid,
        JSON.stringify({
          pid: 12345,
          build: {
            name: 'agent-remnote',
            version: '1.2.9',
            build_id: '1.2.9:old-daemon',
            built_at: 1,
            source_stamp: 1,
            mode: 'src',
          },
        }),
      );
      await fs.writeFile(
        apiPid,
        JSON.stringify({
          pid: 12346,
          build: {
            name: 'agent-remnote',
            version: '1.2.9',
            build_id: '1.2.9:old-api',
            built_at: 1,
            source_stamp: 1,
            mode: 'src',
          },
        }),
      );

      const res = await runCli(
        ['--json', '--daemon-url', 'ws://localhost:0/ws', '--api-port', '1', 'stack', 'status'],
        { env: { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 20_000 },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(typeof parsed.data.runtime?.build_id).toBe('string');
      expect(parsed.data.daemon.build?.build_id).toBe('1.2.9:old-daemon');
      expect(parsed.data.api.build?.build_id).toBe('1.2.9:old-api');
      expect(Array.isArray(parsed.data.warnings)).toBe(true);
      expect(String(parsed.data.warnings.join(' '))).toContain('daemon build mismatch');
      expect(String(parsed.data.warnings.join(' '))).toContain('api build mismatch');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
