import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { promises as fs } from 'node:fs';

import { ensurePluginArtifacts } from '../helpers/ensurePluginArtifacts.js';
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

describe('cli contract: runtime owner stack stop', () => {
  it('stops plugin server as part of the stack bundle', async () => {
    await ensurePluginArtifacts();

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-stack-stop-'));
    const tmpHome = path.join(tmpDir, 'home');
    const pluginPid = path.join(tmpDir, 'plugin-server.pid');
    const pluginLog = path.join(tmpDir, 'plugin-server.log');
    const pluginState = path.join(tmpDir, 'plugin-server.state.json');
    const port = await getFreePort();
    const env = {
      HOME: tmpHome,
      REMNOTE_TMUX_REFRESH: '0',
      REMNOTE_PLUGIN_SERVER_PID_FILE: pluginPid,
      REMNOTE_PLUGIN_SERVER_LOG_FILE: pluginLog,
      REMNOTE_PLUGIN_SERVER_STATE_FILE: pluginState,
    };

    try {
      const startRes = await runCli(['--json', 'plugin', 'start', '--port', String(port)], {
        env,
        timeoutMs: 30_000,
      });
      expect(startRes.exitCode).toBe(0);

      const stopRes = await runCli(['--json', 'stack', 'stop'], {
        env,
        timeoutMs: 30_000,
      });

      expect(stopRes.exitCode).toBe(0);
      expect(stopRes.stderr).toBe('');
      const parsed = JSON.parse(stopRes.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.plugin_stopped).toBe(true);

      await expect(fs.stat(pluginPid)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(pluginState)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      try {
        await runCli(['--json', 'plugin', 'stop', '--pid-file', pluginPid, '--state-file', pluginState], {
          env,
          timeoutMs: 30_000,
        });
      } catch {}
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);
});
