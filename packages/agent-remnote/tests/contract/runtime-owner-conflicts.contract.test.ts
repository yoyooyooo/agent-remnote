import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: runtime owner conflicts', () => {
  it('reports canonical owner mismatch when a trusted live daemon disagrees with the fixed claim', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-conflict-'));
    const tmpHome = path.join(tmpDir, 'home');
    const controlPlaneRoot = path.join(tmpHome, '.agent-remnote');
    const devRoot = path.join(controlPlaneRoot, 'dev', 'fixture');
    const pidFile = path.join(devRoot, 'ws.pid');
    const stateFile = path.join(devRoot, 'ws.state.json');
    const runtimeScript = path.join(tmpDir, 'agent-remnote-runtime.js');

    await fs.mkdir(devRoot, { recursive: true });
    await fs.writeFile(runtimeScript, 'setInterval(() => {}, 1000);\n', 'utf8');
    const child = spawn(process.execPath, [runtimeScript, 'daemon', 'supervisor'], { stdio: 'ignore' });
    if (!child.pid) throw new Error('failed to spawn conflict fixture');

    try {
      await fs.writeFile(
        path.join(controlPlaneRoot, 'fixed-owner-claim.json'),
        JSON.stringify(
          {
            claimed_channel: 'stable',
            claimed_owner_id: 'stable',
            runtime_root: controlPlaneRoot,
            control_plane_root: controlPlaneRoot,
            port_class: 'canonical',
            updated_by: 'initial_bootstrap',
            updated_at: 0,
          },
          null,
          2,
        ),
        'utf8',
      );
      await fs.writeFile(
        pidFile,
        JSON.stringify(
          {
            mode: 'supervisor',
            pid: child.pid,
            state_file: stateFile,
            owner: {
              owner_channel: 'dev',
              owner_id: 'dev',
              install_source: 'source_tree',
              runtime_root: devRoot,
              worktree_root: '/tmp/example-worktree',
              port_class: 'isolated',
              launcher_ref: 'source:/tmp/example-worktree',
            },
            cmd: [process.execPath, runtimeScript, 'daemon', 'supervisor'],
          },
          null,
          2,
        ),
        'utf8',
      );
      await fs.writeFile(stateFile, JSON.stringify({ status: 'running' }, null, 2), 'utf8');

      const res = await runCli(['--json', '--daemon-url', 'ws://localhost:0/ws', '--api-port', '1', 'stack', 'status'], {
        env: { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0', REMNOTE_DAEMON_PID_FILE: pidFile },
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.services.daemon.trusted).toBe(true);
      expect(parsed.data.services.daemon.claimed).toBe(false);
      expect(parsed.data.ownership_conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'canonical_owner_mismatch',
            service: 'daemon',
            repair_strategy: 'manual_takeover_required',
          }),
        ]),
      );
    } finally {
      try {
        child.kill('SIGKILL');
      } catch {}
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
