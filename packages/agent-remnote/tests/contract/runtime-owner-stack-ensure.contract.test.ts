import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { ensurePluginArtifacts } from '../helpers/ensurePluginArtifacts.js';
import { runCli } from '../helpers/runCli.js';

describe('cli contract: runtime owner stack ensure', () => {
  it('starts plugin server as part of the local dev bundle', async () => {
    await ensurePluginArtifacts();

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-stack-ensure-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');
    const pluginPid = path.join(tmpDir, 'plugin-server.pid');
    const pluginLog = path.join(tmpDir, 'plugin-server.log');
    const pluginState = path.join(tmpDir, 'plugin-server.state.json');
    const env = {
      HOME: tmpHome,
      REMNOTE_TMUX_REFRESH: '0',
      REMNOTE_STORE_DB: storeDb,
      REMNOTE_PLUGIN_SERVER_PID_FILE: pluginPid,
      REMNOTE_PLUGIN_SERVER_LOG_FILE: pluginLog,
      REMNOTE_PLUGIN_SERVER_STATE_FILE: pluginState,
    };

    try {
      const ensureRes = await runCli(['--json', 'stack', 'ensure'], {
        env,
        timeoutMs: 30_000,
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
  }, 60_000);
});
