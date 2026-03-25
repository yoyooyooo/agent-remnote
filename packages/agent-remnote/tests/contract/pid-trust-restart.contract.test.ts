import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';

import { runCli } from '../helpers/runCli.js';

async function isAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function trustedCmdStub(kind: 'api' | 'plugin'): string[] {
  const base = ['/usr/local/bin/node', '--import', 'tsx', '/tmp/agent-remnote/src/main.ts'];
  if (kind === 'api') return [...base, 'api', 'serve'];
  return [...base, 'plugin', 'serve'];
}

describe('cli contract: pid trust guard on restart', () => {
  it('refuses api restart when pidfile points at an unrelated live process', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-pid-trust-api-restart-'));
    const pidFile = path.join(tmpDir, 'api.pid');
    const logFile = path.join(tmpDir, 'api.log');
    const stateFile = path.join(tmpDir, 'api.state.json');
    const port = await getFreePort();
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
            port,
            base_path: '/v1',
            log_file: logFile,
            state_file: stateFile,
            cmd: trustedCmdStub('api'),
          },
          null,
          2,
        ),
        'utf8',
      );

      const res = await runCli(
        ['--json', 'api', 'restart', '--port', String(port), '--pid-file', pidFile, '--log-file', logFile, '--state-file', stateFile],
        { env: { HOME: tmpDir, REMNOTE_STORE_DB: path.join(tmpDir, 'store.sqlite'), REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 20_000 },
      );

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(false);
      expect(String(parsed.error.message)).toContain('Refusing to operate on a pidfile');
      expect(await isAlive(dummy.pid)).toBe(true);
      await expect(fs.stat(pidFile)).resolves.toBeTruthy();
    } finally {
      try {
        dummy.kill('SIGKILL');
      } catch {}
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('refuses plugin restart when pidfile points at an unrelated live process', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-pid-trust-plugin-restart-'));
    const pidFile = path.join(tmpDir, 'plugin.pid');
    const logFile = path.join(tmpDir, 'plugin.log');
    const stateFile = path.join(tmpDir, 'plugin.state.json');
    const port = await getFreePort();
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
            port,
            log_file: logFile,
            state_file: stateFile,
            cmd: trustedCmdStub('plugin'),
          },
          null,
          2,
        ),
        'utf8',
      );

      const res = await runCli(
        ['--json', 'plugin', 'restart', '--port', String(port), '--pid-file', pidFile, '--log-file', logFile, '--state-file', stateFile],
        { env: { HOME: tmpDir, REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 20_000 },
      );

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(false);
      expect(String(parsed.error.message)).toContain('Refusing to operate on a pidfile');
      expect(await isAlive(dummy.pid)).toBe(true);
      await expect(fs.stat(pidFile)).resolves.toBeTruthy();
    } finally {
      try {
        dummy.kill('SIGKILL');
      } catch {}
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
