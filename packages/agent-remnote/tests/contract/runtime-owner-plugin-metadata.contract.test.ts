import { beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

function repoRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '../../../../');
}

describe('cli contract: runtime owner plugin metadata', () => {
  beforeAll(async () => {
    await ensurePluginArtifacts();
  });

  it('exposes source-tree owner metadata through plugin status', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-plugin-'));
    const tmpHome = path.join(tmpDir, 'home');
    const controlPlaneRoot = path.join(tmpHome, '.agent-remnote');
    const worktreeRoot = repoRoot();
    const pidFile = path.join(tmpDir, 'plugin-server.pid');
    const logFile = path.join(tmpDir, 'plugin-server.log');
    const stateFile = path.join(tmpDir, 'plugin-server.state.json');
    const port = await getFreePort();
    const env = { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0' };

    try {
      const startRes = await runCli(
        ['--json', 'plugin', 'start', '--port', String(port), '--pid-file', pidFile, '--log-file', logFile, '--state-file', stateFile],
        { env, timeoutMs: 30_000 },
      );
      expect(startRes.exitCode).toBe(0);

      const statusRes = await runCli(['--json', 'plugin', 'status', '--pid-file', pidFile, '--state-file', stateFile], {
        env,
        timeoutMs: 30_000,
      });
      expect(statusRes.exitCode).toBe(0);
      expect(statusRes.stderr).toBe('');

      const parsed = JSON.parse(statusRes.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.service.owner).toMatchObject({
        owner_channel: 'dev',
        install_source: 'source_tree',
        runtime_root: expect.stringContaining(path.normalize(path.join(controlPlaneRoot, 'dev'))),
        worktree_root: path.normalize(worktreeRoot),
      });
      expect(typeof parsed.data.service.owner.launcher_ref).toBe('string');
    } finally {
      try {
        await runCli(['--json', 'plugin', 'stop', '--pid-file', pidFile, '--state-file', stateFile], {
          env,
          timeoutMs: 30_000,
        });
      } catch {}
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);
});
