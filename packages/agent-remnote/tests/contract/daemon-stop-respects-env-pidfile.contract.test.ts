import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: daemon stop respects REMNOTE_DAEMON_PID_FILE when --pid-file is omitted', () => {
  it('uses env pidfile path as the default', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-cli-test-'));
    const pidFile = path.join(tmpDir, 'ws.pid');
    const stateFile = path.join(tmpDir, 'ws.state.json');
    const runtimeScript = path.join(tmpDir, 'agent-remnote-runtime.js');

    await fs.writeFile(runtimeScript, 'setInterval(() => {}, 1000);\n', 'utf8');
    const dummy = spawn(process.execPath, [runtimeScript, 'daemon', 'supervisor'], { stdio: 'ignore' });
    if (!dummy.pid) throw new Error('failed to spawn dummy process');

    try {
      await fs.writeFile(
        pidFile,
        JSON.stringify({
          mode: 'supervisor',
          pid: dummy.pid,
          child_pid: null,
          started_at: Date.now(),
          ws_url: 'ws://localhost:0/ws',
          log_file: path.join(tmpDir, 'ws.log'),
          state_file: stateFile,
          cmd: [process.execPath, runtimeScript, 'daemon', 'supervisor'],
        }),
        'utf8',
      );
      await fs.writeFile(
        stateFile,
        JSON.stringify({
          status: 'running',
          restart_count: 0,
          restart_window_started_at: Date.now(),
          backoff_until: null,
          last_exit: null,
          failed_reason: null,
        }),
        'utf8',
      );

      const res = await runCli(['--json', 'daemon', 'stop', '--force'], {
        env: { HOME: tmpDir, REMNOTE_DAEMON_PID_FILE: pidFile, REMNOTE_TMUX_REFRESH: '0' },
      });
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(stateFile)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      try {
        dummy.kill('SIGKILL');
      } catch {}
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
