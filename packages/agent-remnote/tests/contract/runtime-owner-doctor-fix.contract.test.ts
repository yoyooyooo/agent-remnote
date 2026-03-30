import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

import { acquireCanonicalRuntimeLock } from '../helpers/canonicalRuntimeLock.js';
import { ensurePluginArtifacts } from '../helpers/ensurePluginArtifacts.js';
import { runCli } from '../helpers/runCli.js';

function createMinimalRemnoteDb(dbPath: string) {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE quanta (
        _id TEXT PRIMARY KEY,
        doc TEXT NOT NULL
      );
    `);
    db.prepare('INSERT INTO quanta (_id, doc) VALUES (?, ?)').run('page1', JSON.stringify({ _id: 'page1', key: ['Page'] }));
  } finally {
    db.close();
  }
}

describe('cli contract: runtime owner doctor --fix', () => {
  let releaseLock: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    await ensurePluginArtifacts();
  }, 240_000);

  beforeAll(async () => {
    releaseLock = await acquireCanonicalRuntimeLock();
  }, 240_000);

  afterAll(async () => {
    await releaseLock?.();
  });

  it('persists the canonical stable fixed-owner claim when missing', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-doctor-fix-'));
    const tmpHome = path.join(tmpDir, 'home');
    const remnoteDb = path.join(tmpDir, 'remnote.db');
    const claimFile = path.join(tmpHome, '.agent-remnote', 'fixed-owner-claim.json');

    try {
      createMinimalRemnoteDb(remnoteDb);

      const res = await runCli(['--json', '--remnote-db', remnoteDb, 'doctor', '--fix'], {
        env: { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.fixed_owner_claim).toMatchObject({
        claimed_channel: 'stable',
        control_plane_root: path.join(tmpHome, '.agent-remnote'),
        port_class: 'canonical',
      });

      const onDisk = JSON.parse(await fs.readFile(claimFile, 'utf8'));
      expect(onDisk).toMatchObject({
        claimed_channel: 'stable',
        control_plane_root: path.join(tmpHome, '.agent-remnote'),
        port_class: 'canonical',
        updated_by: 'doctor_fix',
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('realigns a trusted dev bundle back to the stable claim', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-doctor-realign-'));
    const tmpHome = path.join(tmpDir, 'home');
    const remnoteDb = path.join(tmpDir, 'remnote.db');
    const stateDir = path.join(tmpHome, '.agent-remnote', 'dev-bundle');
    const claimFile = path.join(tmpHome, '.agent-remnote', 'fixed-owner-claim.json');
    const daemonPidFile = path.join(stateDir, 'ws.pid');
    const daemonStateFile = path.join(stateDir, 'ws.state.json');
    const apiPidFile = path.join(stateDir, 'api.pid');
    const apiStateFile = path.join(stateDir, 'api.state.json');
    const pluginPidFile = path.join(stateDir, 'plugin-server.pid');
    const pluginStateFile = path.join(stateDir, 'plugin-server.state.json');
    const runtimeScript = path.join(tmpDir, 'agent-remnote-runtime.js');
    const env = {
      HOME: tmpHome,
      REMNOTE_TMUX_REFRESH: '0',
      REMNOTE_STORE_DB: path.join(tmpDir, 'store.sqlite'),
      REMNOTE_DAEMON_PID_FILE: daemonPidFile,
      REMNOTE_API_PID_FILE: apiPidFile,
      REMNOTE_API_STATE_FILE: apiStateFile,
      REMNOTE_PLUGIN_SERVER_PID_FILE: pluginPidFile,
      REMNOTE_PLUGIN_SERVER_STATE_FILE: pluginStateFile,
    };
    let daemon:
      | import('node:child_process').ChildProcess
      | undefined;
    let api:
      | import('node:child_process').ChildProcess
      | undefined;
    let plugin:
      | import('node:child_process').ChildProcess
      | undefined;

    try {
      createMinimalRemnoteDb(remnoteDb);
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(runtimeScript, 'setInterval(() => {}, 1000);\n', 'utf8');

      daemon = spawn(process.execPath, [runtimeScript, 'daemon', 'supervisor'], { stdio: 'ignore' });
      api = spawn(process.execPath, [runtimeScript, 'api', 'serve'], { stdio: 'ignore' });
      plugin = spawn(process.execPath, [runtimeScript, 'plugin', 'serve'], { stdio: 'ignore' });
      if (!daemon.pid || !api.pid || !plugin.pid) throw new Error('failed to spawn fake dev bundle');

      await fs.writeFile(
        daemonPidFile,
        JSON.stringify(
          {
            mode: 'supervisor',
            pid: daemon.pid,
            state_file: daemonStateFile,
            owner: {
              owner_channel: 'dev',
              owner_id: 'dev',
              install_source: 'source_tree',
              runtime_root: stateDir,
              worktree_root: path.join(tmpDir, 'worktree'),
              port_class: 'canonical',
              launcher_ref: `source:${path.join(tmpDir, 'worktree')}`,
            },
            cmd: [process.execPath, runtimeScript, 'daemon', 'supervisor'],
          },
          null,
          2,
        ),
        'utf8',
      );
      await fs.writeFile(daemonStateFile, JSON.stringify({ status: 'running' }, null, 2), 'utf8');
      await fs.writeFile(
        apiPidFile,
        JSON.stringify(
          {
            pid: api.pid,
            host: '127.0.0.1',
            port: 3000,
            base_path: '/v1',
            state_file: apiStateFile,
            owner: {
              owner_channel: 'dev',
              owner_id: 'dev',
              install_source: 'source_tree',
              runtime_root: stateDir,
              worktree_root: path.join(tmpDir, 'worktree'),
              port_class: 'canonical',
              launcher_ref: `source:${path.join(tmpDir, 'worktree')}`,
            },
            cmd: [process.execPath, runtimeScript, 'api', 'serve'],
          },
          null,
          2,
        ),
        'utf8',
      );
      await fs.writeFile(apiStateFile, JSON.stringify({ running: true, pid: api.pid }, null, 2), 'utf8');
      await fs.writeFile(
        pluginPidFile,
        JSON.stringify(
          {
            pid: plugin.pid,
            host: '127.0.0.1',
            port: 8080,
            state_file: pluginStateFile,
            owner: {
              owner_channel: 'dev',
              owner_id: 'dev',
              install_source: 'source_tree',
              runtime_root: stateDir,
              worktree_root: path.join(tmpDir, 'worktree'),
              port_class: 'canonical',
              launcher_ref: `source:${path.join(tmpDir, 'worktree')}`,
            },
            cmd: [process.execPath, runtimeScript, 'plugin', 'serve'],
          },
          null,
          2,
        ),
        'utf8',
      );
      await fs.writeFile(pluginStateFile, JSON.stringify({ running: true, pid: plugin.pid }, null, 2), 'utf8');

      await fs.writeFile(
        claimFile,
        JSON.stringify(
          {
            claimed_channel: 'stable',
            claimed_owner_id: 'stable',
            runtime_root: path.join(tmpHome, '.agent-remnote'),
            control_plane_root: path.join(tmpHome, '.agent-remnote'),
            port_class: 'canonical',
            updated_by: 'stack_takeover',
            updated_at: Date.now(),
            launcher_ref: 'published:agent-remnote',
          },
          null,
          2,
        ),
        'utf8',
      );

      const res = await runCli(['--json', '--remnote-db', remnoteDb, 'doctor', '--fix'], {
        env,
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      const realignFix = (parsed.data.fixes ?? []).find((item: any) => item.id === 'runtime.realign_fixed_owner_claimed_services');
      expect(realignFix?.ok).toBe(true);
      expect(realignFix?.changed).toBe(true);

      const statusRes = await runCli(['--json', 'stack', 'status'], {
        env,
        timeoutMs: 30_000,
      });
      expect(statusRes.exitCode).toBe(0);
      const status = JSON.parse(statusRes.stdout.trim());
      expect(status.data.fixed_owner_claim.claimed_channel).toBe('stable');
      expect(status.data.services.daemon.running).toBe(false);
      expect(status.data.services.api.running).toBe(false);
      expect(status.data.services.plugin.running).toBe(false);
    } finally {
      for (const child of [daemon, api, plugin]) {
        if (!child) continue;
        try {
          child.kill('SIGKILL');
        } catch {}
      }
      await runCli(['--json', 'stack', 'stop'], { env, timeoutMs: 30_000 }).catch(() => undefined);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 120_000);
});
