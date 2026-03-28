import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: runtime owner daemon status', () => {
  it('surfaces owner metadata from daemon pid files', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-daemon-'));
    const tmpHome = path.join(tmpDir, 'home');
    const pidFile = path.join(tmpDir, 'ws.pid');

    try {
      await fs.mkdir(tmpHome, { recursive: true });
      await fs.writeFile(
        pidFile,
        JSON.stringify(
          {
            mode: 'supervisor',
            pid: process.pid,
            owner: {
              owner_channel: 'dev',
              owner_id: 'dev',
              install_source: 'source_tree',
              runtime_root: path.join(tmpHome, '.agent-remnote', 'dev', 'abc'),
              worktree_root: '/tmp/example-worktree',
              port_class: 'isolated',
              launcher_ref: 'source:/tmp/example-worktree',
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      const res = await runCli(['--json', '--daemon-url', 'ws://localhost:0/ws', 'daemon', 'status', '--pid-file', pidFile], {
        env: { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.service.owner).toMatchObject({
        owner_channel: 'dev',
        install_source: 'source_tree',
        launcher_ref: 'source:/tmp/example-worktree',
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
