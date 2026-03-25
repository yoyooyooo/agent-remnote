import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: daemon stop (supervisor pid) cleans up pid/state', () => {
  it('stops target pid and deletes pidfile/statefile', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-cli-test-'));
    const pidFile = path.join(tmpDir, 'ws.pid');
    const stateFile = path.join(tmpDir, 'ws.state.json');

    const artifactsDir = path.join(tmpDir, 'artifacts');
    const wsBridgeStateFile = path.join(artifactsDir, 'ws.bridge.state.json');
    const statusLineFile = path.join(artifactsDir, 'status-line.txt');
    const statusLineJsonFile = path.join(artifactsDir, 'status-line.json');
    const runtimeScript = path.join(tmpDir, 'agent-remnote-runtime.js');

    await fs.writeFile(runtimeScript, 'setInterval(() => {}, 1000);\n', 'utf8');
    const dummy = spawn(process.execPath, [runtimeScript, 'daemon', 'supervisor'], { stdio: 'ignore' });
    if (!dummy.pid) throw new Error('failed to spawn dummy process');

    try {
      await fs.mkdir(artifactsDir, { recursive: true });
      await fs.writeFile(
        wsBridgeStateFile,
        JSON.stringify({ updatedAt: Date.now(), clients: [], activeWorkerConnId: null }, null, 2),
        'utf8',
      );
      await fs.writeFile(statusLineFile, 'RN\n', 'utf8');
      await fs.writeFile(statusLineJsonFile, JSON.stringify({ text: 'RN' }, null, 2), 'utf8');

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
          ws_bridge_state_file: wsBridgeStateFile,
          status_line_file: statusLineFile,
          status_line_json_file: statusLineJsonFile,
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

      const res = await runCli(['--json', 'daemon', 'stop', '--force', '--pid-file', pidFile], {
        env: { HOME: tmpDir },
      });
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(stateFile)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(wsBridgeStateFile)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(statusLineJsonFile)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.readFile(statusLineFile, 'utf8')).resolves.toBe('');

      let alive = true;
      try {
        process.kill(dummy.pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
      expect(alive).toBe(false);
    } finally {
      try {
        dummy.kill('SIGKILL');
      } catch {}
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
