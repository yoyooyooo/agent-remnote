import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { promises as fs } from 'node:fs';

import { ensurePluginArtifacts } from '../helpers/ensurePluginArtifacts.js';
import { acquireCanonicalRuntimeLock } from '../helpers/canonicalRuntimeLock.js';
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

function isolatedRuntimeEnv(home: string, extras: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const scrubbed = Object.fromEntries(
    Object.keys(process.env)
      .filter((key) => /^(REMNOTE_|AGENT_REMNOTE_)/.test(key) || key === 'PORT' || key === 'WS_PORT' || key === 'STORE_DB' || key === 'QUEUE_DB' || key === 'DAEMON_URL' || key === 'VOLTA_HOME')
      .map((key) => [key, '']),
  );
  return {
    ...scrubbed,
    HOME: home,
    PORT: '',
    REMNOTE_TMUX_REFRESH: '0',
    REMNOTE_API_BASE_URL: '',
    REMNOTE_API_HOST: '',
    REMNOTE_API_PORT: '',
    REMNOTE_API_BASE_PATH: '',
    REMNOTE_WS_PORT: '',
    WS_PORT: '',
    REMNOTE_DAEMON_URL: '',
    DAEMON_URL: '',
    AGENT_REMNOTE_STABLE_LAUNCHER_CMD: '',
    AGENT_REMNOTE_STABLE_LAUNCHER_ARGS_JSON: '',
    VOLTA_HOME: '',
    ...extras,
  };
}

describe('cli contract: runtime owner stack ensure', () => {
  let releaseLock: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    releaseLock = await acquireCanonicalRuntimeLock();
  }, 240_000);

  afterAll(async () => {
    await releaseLock?.();
  });

  it('starts plugin server as part of the local dev bundle', async () => {
    await ensurePluginArtifacts();

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-stack-ensure-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');
    const pluginPid = path.join(tmpDir, 'plugin-server.pid');
    const pluginLog = path.join(tmpDir, 'plugin-server.log');
    const pluginState = path.join(tmpDir, 'plugin-server.state.json');
    const wsPort = await getFreePort();
    const apiPort = await getFreePort();
    const env = isolatedRuntimeEnv(tmpHome, {
      REMNOTE_STORE_DB: storeDb,
      REMNOTE_WS_PORT: String(wsPort),
      REMNOTE_API_PORT: String(apiPort),
      REMNOTE_PLUGIN_SERVER_PID_FILE: pluginPid,
      REMNOTE_PLUGIN_SERVER_LOG_FILE: pluginLog,
      REMNOTE_PLUGIN_SERVER_STATE_FILE: pluginState,
    });

    try {
      await fs.mkdir(tmpHome, { recursive: true });
      const ensureRes = await runCli(['--json', 'stack', 'ensure'], {
        env,
        timeoutMs: 90_000,
      });

      expect(ensureRes.exitCode).toBe(0);
      expect(ensureRes.stderr).toBe('');
      const parsed = JSON.parse(ensureRes.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.plugin).toMatchObject({
        pid_file: pluginPid,
      });
      expect(typeof parsed.data.plugin.base_url).toBe('string');

      await expect(fs.stat(pluginPid)).resolves.toBeTruthy();
      await expect(fs.stat(pluginState)).resolves.toBeTruthy();
    } finally {
      await runCli(['--json', 'stack', 'stop'], { env, timeoutMs: 30_000 }).catch(() => undefined);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 120_000);
});
