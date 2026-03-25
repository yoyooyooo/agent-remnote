import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';

import { runCli } from '../helpers/runCli.js';

async function isAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function trustedCmdStub(kind: 'daemon' | 'api' | 'plugin'): string[] {
  const base = ['/usr/local/bin/node', '--import', 'tsx', '/tmp/agent-remnote/src/main.ts'];
  if (kind === 'daemon') return [...base, 'daemon', 'serve'];
  if (kind === 'api') return [...base, 'api', 'serve'];
  return [...base, 'plugin', 'serve'];
}

describe('cli contract: pid trust guard', () => {
  it('refuses daemon stop when pidfile points at an unrelated live process', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-pid-trust-daemon-'));
    const pidFile = path.join(tmpDir, 'ws.pid');
    const stateFile = path.join(tmpDir, 'ws.state.json');
    const dummy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    if (!dummy.pid) throw new Error('failed to spawn dummy process');

    try {
      await fs.writeFile(
        pidFile,
        JSON.stringify(
          {
            mode: 'supervisor',
            pid: dummy.pid,
            child_pid: null,
            started_at: Date.now(),
            ws_url: 'ws://localhost:0/ws',
            log_file: path.join(tmpDir, 'ws.log'),
            state_file: stateFile,
            cmd: trustedCmdStub('daemon'),
          },
          null,
          2,
        ),
        'utf8',
      );
      await fs.writeFile(stateFile, JSON.stringify({ status: 'running' }, null, 2), 'utf8');

      const res = await runCli(['--json', 'daemon', 'stop', '--force', '--pid-file', pidFile], {
        env: { HOME: tmpDir, REMNOTE_TMUX_REFRESH: '0' },
      });

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(false);
      expect(String(parsed.error.message)).toContain('Refusing to operate on a pidfile');
      expect(await isAlive(dummy.pid)).toBe(true);
      await expect(fs.stat(pidFile)).resolves.toBeTruthy();
      await expect(fs.stat(stateFile)).resolves.toBeTruthy();
    } finally {
      try {
        dummy.kill('SIGKILL');
      } catch {}
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('refuses api stop when pidfile points at an unrelated live process', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-pid-trust-api-'));
    const pidFile = path.join(tmpDir, 'api.pid');
    const stateFile = path.join(tmpDir, 'api.state.json');
    const dummy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    if (!dummy.pid) throw new Error('failed to spawn dummy process');

    try {
      await fs.writeFile(
        pidFile,
        JSON.stringify(
          {
            pid: dummy.pid,
            started_at: Date.now(),
            host: '127.0.0.1',
            port: 3000,
            base_path: '/v1',
            log_file: path.join(tmpDir, 'api.log'),
            state_file: stateFile,
            cmd: trustedCmdStub('api'),
          },
          null,
          2,
        ),
        'utf8',
      );
      await fs.writeFile(stateFile, JSON.stringify({ running: true, pid: dummy.pid }, null, 2), 'utf8');

      const res = await runCli(['--json', 'api', 'stop', '--pid-file', pidFile, '--state-file', stateFile], {
        env: { HOME: tmpDir, REMNOTE_TMUX_REFRESH: '0' },
      });

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(false);
      expect(String(parsed.error.message)).toContain('Refusing to operate on a pidfile');
      expect(await isAlive(dummy.pid)).toBe(true);
      await expect(fs.stat(pidFile)).resolves.toBeTruthy();
      await expect(fs.stat(stateFile)).resolves.toBeTruthy();
    } finally {
      try {
        dummy.kill('SIGKILL');
      } catch {}
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('refuses plugin stop when pidfile points at an unrelated live process', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-pid-trust-plugin-'));
    const pidFile = path.join(tmpDir, 'plugin.pid');
    const stateFile = path.join(tmpDir, 'plugin.state.json');
    const dummy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    if (!dummy.pid) throw new Error('failed to spawn dummy process');

    try {
      await fs.writeFile(
        pidFile,
        JSON.stringify(
          {
            pid: dummy.pid,
            started_at: Date.now(),
            host: '127.0.0.1',
            port: 8080,
            log_file: path.join(tmpDir, 'plugin.log'),
            state_file: stateFile,
            cmd: trustedCmdStub('plugin'),
          },
          null,
          2,
        ),
        'utf8',
      );
      await fs.writeFile(stateFile, JSON.stringify({ running: true, pid: dummy.pid }, null, 2), 'utf8');

      const res = await runCli(['--json', 'plugin', 'stop', '--pid-file', pidFile, '--state-file', stateFile], {
        env: { HOME: tmpDir, REMNOTE_TMUX_REFRESH: '0' },
      });

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(false);
      expect(String(parsed.error.message)).toContain('Refusing to operate on a pidfile');
      expect(await isAlive(dummy.pid)).toBe(true);
      await expect(fs.stat(pidFile)).resolves.toBeTruthy();
      await expect(fs.stat(stateFile)).resolves.toBeTruthy();
    } finally {
      try {
        dummy.kill('SIGKILL');
      } catch {}
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
