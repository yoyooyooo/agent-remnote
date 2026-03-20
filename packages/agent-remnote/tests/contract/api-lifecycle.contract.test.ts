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

describe('cli contract: api lifecycle', () => {
  it('starts host api in background, reports healthy status, and stops cleanly', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-api-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');
    const pidFile = path.join(tmpDir, 'api.pid');
    const logFile = path.join(tmpDir, 'api.log');
    const stateFile = path.join(tmpDir, 'api.state.json');
    const port = await getFreePort();
    const basePath = '/remnote/v1';

    try {
      const startRes = await runCli(
        [
          '--json',
          '--api-base-path',
          basePath,
          'api',
          'start',
          '--port',
          String(port),
          '--pid-file',
          pidFile,
          '--log-file',
          logFile,
          '--state-file',
          stateFile,
        ],
        { env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 20_000 },
      );

      expect(startRes.exitCode).toBe(0);
      expect(startRes.stderr).toBe('');
      const startEnv = JSON.parse(startRes.stdout.trim());
      expect(startEnv.ok).toBe(true);
      expect(startEnv.data.base_url).toBe(`http://127.0.0.1:${port}${basePath}`);

      const healthRes = await fetch(`http://127.0.0.1:${port}${basePath}/health`);
      expect(healthRes.status).toBe(200);
      const healthJson = await healthRes.json();
      expect(healthJson.ok).toBe(true);
      expect(healthJson.data.api.running).toBe(true);
      expect(healthJson.data.basePath).toBe(basePath);

      const statusRes = await runCli(['--json', 'api', 'status', '--pid-file', pidFile, '--state-file', stateFile], {
        env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 20_000,
      });
      expect(statusRes.exitCode).toBe(0);
      expect(statusRes.stderr).toBe('');
      const statusEnv = JSON.parse(statusRes.stdout.trim());
      expect(statusEnv.ok).toBe(true);
      expect(typeof statusEnv.data.runtime?.version).toBe('string');
      expect(typeof statusEnv.data.service.build?.build_id).toBe('string');
      expect(statusEnv.data.service.running).toBe(true);
      expect(statusEnv.data.api.healthy).toBe(true);
      expect(statusEnv.data.api.base_url).toBe(`http://127.0.0.1:${port}${basePath}`);
      expect(statusEnv.data.state.basePath).toBe(basePath);

      const stopRes = await runCli(['--json', 'api', 'stop', '--pid-file', pidFile, '--state-file', stateFile], {
        env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' },
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
  }, 40_000);
});
