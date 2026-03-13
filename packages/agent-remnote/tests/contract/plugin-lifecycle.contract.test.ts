import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { promises as fs } from 'node:fs';

import { runCli } from '../helpers/runCli.js';

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

describe('cli contract: plugin lifecycle', () => {
  it('starts the plugin server in background, reports status, logs, restart, and stops cleanly', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-plugin-server-'));
    const tmpHome = path.join(tmpDir, 'home');
    const pidFile = path.join(tmpDir, 'plugin-server.pid');
    const logFile = path.join(tmpDir, 'plugin-server.log');
    const stateFile = path.join(tmpDir, 'plugin-server.state.json');
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const env = { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0' };

      const startRes = await runCli(
        ['--json', 'plugin', 'start', '--port', String(port), '--pid-file', pidFile, '--log-file', logFile, '--state-file', stateFile],
        { env, timeoutMs: 20_000 },
      );
      expect(startRes.exitCode).toBe(0);
      expect(startRes.stderr).toBe('');
      const startEnv = JSON.parse(startRes.stdout.trim());
      expect(startEnv.ok).toBe(true);
      expect(startEnv.data.started).toBe(true);
      expect(startEnv.data.base_url).toBe(baseUrl);

      const manifestRes = await fetch(`${baseUrl}/manifest.json`);
      expect(manifestRes.status).toBe(200);

      const ensureRes = await runCli(
        ['--json', 'plugin', 'ensure', '--port', String(port), '--pid-file', pidFile, '--log-file', logFile, '--state-file', stateFile],
        { env, timeoutMs: 20_000 },
      );
      expect(ensureRes.exitCode).toBe(0);
      expect(ensureRes.stderr).toBe('');
      const ensureEnv = JSON.parse(ensureRes.stdout.trim());
      expect(ensureEnv.ok).toBe(true);
      expect(ensureEnv.data.started).toBe(false);
      expect(ensureEnv.data.base_url).toBe(baseUrl);

      const statusRes = await runCli(['--json', 'plugin', 'status', '--pid-file', pidFile, '--state-file', stateFile], {
        env,
        timeoutMs: 20_000,
      });
      expect(statusRes.exitCode).toBe(0);
      expect(statusRes.stderr).toBe('');
      const statusEnv = JSON.parse(statusRes.stdout.trim());
      expect(statusEnv.ok).toBe(true);
      expect(statusEnv.data.service.running).toBe(true);
      expect(statusEnv.data.plugin_server.healthy).toBe(true);
      expect(statusEnv.data.plugin_server.base_url).toBe(baseUrl);

      const logsRes = await runCli(['--json', 'plugin', 'logs', '--pid-file', pidFile, '--lines', '20'], {
        env,
        timeoutMs: 20_000,
      });
      expect(logsRes.exitCode).toBe(0);
      expect(logsRes.stderr).toBe('');
      const logsEnv = JSON.parse(logsRes.stdout.trim());
      expect(logsEnv.ok).toBe(true);
      expect(String(logsEnv.data.content || '')).toContain('Local:');

      const restartRes = await runCli(
        ['--json', 'plugin', 'restart', '--port', String(port), '--pid-file', pidFile, '--log-file', logFile, '--state-file', stateFile],
        { env, timeoutMs: 20_000 },
      );
      expect(restartRes.exitCode).toBe(0);
      expect(restartRes.stderr).toBe('');
      const restartEnv = JSON.parse(restartRes.stdout.trim());
      expect(restartEnv.ok).toBe(true);
      expect(restartEnv.data.started).toBe(true);
      expect(restartEnv.data.base_url).toBe(baseUrl);
      expect(restartEnv.data.stopped_pid).toBeTruthy();

      const stopRes = await runCli(['--json', 'plugin', 'stop', '--pid-file', pidFile, '--state-file', stateFile], {
        env,
        timeoutMs: 20_000,
      });
      expect(stopRes.exitCode).toBe(0);
      expect(stopRes.stderr).toBe('');
      const stopEnv = JSON.parse(stopRes.stdout.trim());
      expect(stopEnv.ok).toBe(true);
      expect(stopEnv.data.stopped).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);
});
