import { beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

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

async function createDeadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const pid = child.pid;
  if (!pid) throw new Error('failed to create dummy pid');
  child.kill('SIGKILL');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`dummy pid ${pid} did not exit in time`)), 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  return pid;
}

function trustedCmdStub(kind: 'daemon' | 'api' | 'plugin'): string[] {
  const base = [process.execPath, '--import', 'tsx', path.join(os.tmpdir(), 'agent-remnote', 'src', 'main.ts')];
  if (kind === 'daemon') return [...base, 'daemon', 'supervisor'];
  if (kind === 'api') return [...base, 'api', 'serve'];
  return [...base, 'plugin', 'serve'];
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

describe('cli contract: doctor --fix', () => {
  beforeAll(async () => {
    await ensurePluginArtifacts();
  });

  it('repairs stale runtime artifacts and rewrites canonical config', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-doctor-fix-'));
    const tmpHome = path.join(tmpDir, 'home');
    const stateDir = path.join(tmpHome, '.agent-remnote');
    const remnoteDb = path.join(tmpDir, 'remnote.db');
    const configFile = path.join(stateDir, 'config.json');
    const daemonPid = path.join(stateDir, 'ws.pid');
    const daemonState = path.join(stateDir, 'ws.state.json');
    const apiPid = path.join(stateDir, 'api.pid');
    const apiState = path.join(stateDir, 'api.state.json');
    const pluginPid = path.join(stateDir, 'plugin-server.pid');
    const pluginState = path.join(stateDir, 'plugin-server.state.json');

    try {
      createMinimalRemnoteDb(remnoteDb);
      await fs.mkdir(stateDir, { recursive: true });
      const deadPid = await createDeadPid();

      await fs.writeFile(
        configFile,
        JSON.stringify(
          {
            api: {
              baseUrl: 'http://127.0.0.1:3000',
              host: '127.0.0.1',
              port: 3001,
              basePath: 'v2',
            },
            keepMe: true,
          },
          null,
          2,
        ),
        'utf8',
      );

      await fs.writeFile(
        daemonPid,
        JSON.stringify({ pid: deadPid, mode: 'supervisor', state_file: daemonState }, null, 2),
        'utf8',
      );
      await fs.writeFile(
        daemonState,
        JSON.stringify({ status: 'running', restart_count: 0, restart_window_started_at: Date.now() }, null, 2),
        'utf8',
      );
      await fs.writeFile(apiPid, JSON.stringify({ pid: deadPid, state_file: apiState }, null, 2), 'utf8');
      await fs.writeFile(apiState, JSON.stringify({ running: true, pid: deadPid }, null, 2), 'utf8');
      await fs.writeFile(pluginPid, JSON.stringify({ pid: deadPid, state_file: pluginState }, null, 2), 'utf8');
      await fs.writeFile(pluginState, JSON.stringify({ running: true, pid: deadPid }, null, 2), 'utf8');

      const res = await runCli(['--json', '--remnote-db', remnoteDb, 'doctor', '--fix'], {
        env: {
          HOME: tmpHome,
          REMNOTE_TMUX_REFRESH: '0',
          REMNOTE_DAEMON_PID_FILE: daemonPid,
          REMNOTE_API_PID_FILE: apiPid,
          REMNOTE_API_STATE_FILE: apiState,
          REMNOTE_PLUGIN_SERVER_PID_FILE: pluginPid,
          REMNOTE_PLUGIN_SERVER_STATE_FILE: pluginState,
        },
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data?.changed).toBe(true);
      expect(parsed.data?.overall_ok).toBe(false);
      expect(Array.isArray(parsed.data?.checks)).toBe(true);
      expect(Array.isArray(parsed.data?.fixes)).toBe(true);
      const staleCheck = (parsed.data?.checks ?? []).find((item: any) => item.id === 'runtime.stale_pid_or_state');
      expect(staleCheck?.ok).toBe(true);
      expect(staleCheck?.repairable).toBe(false);
      const configCheck = (parsed.data?.checks ?? []).find((item: any) => item.id === 'config.migration_needed');
      expect(configCheck?.ok).toBe(true);
      expect(configCheck?.severity).toBe('info');
      const configFix = (parsed.data?.fixes ?? []).find((item: any) => item.id === 'config.rewrite_canonical_user_config');
      expect(configFix?.ok).toBe(true);
      expect(configFix?.changed).toBe(true);
      expect(String(JSON.stringify(parsed.data?.checks))).toContain('runtime.stale_pid_or_state');
      expect(String(JSON.stringify(parsed.data?.checks))).toContain('config.migration_needed');

      await expect(fs.stat(daemonPid)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(daemonState)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(apiPid)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(apiState)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(pluginPid)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(pluginState)).rejects.toMatchObject({ code: 'ENOENT' });

      const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
      expect(config).toMatchObject({
        apiBaseUrl: 'http://127.0.0.1:3000',
        apiHost: '127.0.0.1',
        apiPort: 3001,
        apiBasePath: '/v2',
        keepMe: true,
      });
      expect(config.api).toBeUndefined();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 40_000);

  it('does not rewrite conflicting config keys', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-doctor-fix-conflict-'));
    const tmpHome = path.join(tmpDir, 'home');
    const stateDir = path.join(tmpHome, '.agent-remnote');
    const remnoteDb = path.join(tmpDir, 'remnote.db');
    const configFile = path.join(stateDir, 'config.json');

    try {
      createMinimalRemnoteDb(remnoteDb);
      await fs.mkdir(stateDir, { recursive: true });

      const original = JSON.stringify(
        {
          apiPort: 3001,
          api: { port: 3002 },
          keepMe: true,
        },
        null,
        2,
      );
      await fs.writeFile(configFile, original, 'utf8');

      const res = await runCli(['--json', '--remnote-db', remnoteDb, 'doctor', '--fix'], {
        env: { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(String(JSON.stringify(parsed.data?.checks))).toContain('config.migration_needed');
      expect(String(JSON.stringify(parsed.data?.fixes))).toContain('config.rewrite_canonical_user_config');
      expect(parsed.data?.overall_ok).toBe(false);
      const configCheck = (parsed.data?.checks ?? []).find((item: any) => item.id === 'config.migration_needed');
      expect(configCheck?.ok).toBe(false);
      expect(configCheck?.severity).toBe('error');
      const configFix = (parsed.data?.fixes ?? []).find((item: any) => item.id === 'config.rewrite_canonical_user_config');
      expect(configFix?.ok).toBe(false);
      expect(configFix?.changed).toBe(false);

      const current = await fs.readFile(configFile, 'utf8');
      expect(current.trim()).toBe(original.trim());
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 40_000);

  it('cleans live but untrusted runtime artifacts using recorded state_file paths', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-doctor-fix-live-untrusted-'));
    const tmpHome = path.join(tmpDir, 'home');
    const stateDir = path.join(tmpHome, '.agent-remnote');
    const remnoteDb = path.join(tmpDir, 'remnote.db');
    const daemonPid = path.join(stateDir, 'ws.pid');
    const apiPid = path.join(stateDir, 'api.pid');
    const pluginPid = path.join(stateDir, 'plugin-server.pid');
    const runtimeStateDir = path.join(stateDir, 'custom-runtime');
    const daemonState = path.join(runtimeStateDir, 'ws-custom.state.json');
    const apiState = path.join(runtimeStateDir, 'api-custom.state.json');
    const pluginState = path.join(runtimeStateDir, 'plugin-custom.state.json');
    const dummy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    if (!dummy.pid) throw new Error('failed to spawn dummy process');

    try {
      createMinimalRemnoteDb(remnoteDb);
      await fs.mkdir(stateDir, { recursive: true });
      await fs.mkdir(runtimeStateDir, { recursive: true });

      await fs.writeFile(
        daemonPid,
        JSON.stringify({ pid: dummy.pid, mode: 'supervisor', state_file: daemonState, cmd: trustedCmdStub('daemon') }, null, 2),
        'utf8',
      );
      await fs.writeFile(
        apiPid,
        JSON.stringify({ pid: dummy.pid, state_file: apiState, cmd: trustedCmdStub('api') }, null, 2),
        'utf8',
      );
      await fs.writeFile(
        pluginPid,
        JSON.stringify({ pid: dummy.pid, state_file: pluginState, cmd: trustedCmdStub('plugin') }, null, 2),
        'utf8',
      );
      await fs.writeFile(daemonState, JSON.stringify({ status: 'running' }, null, 2), 'utf8');
      await fs.writeFile(apiState, JSON.stringify({ running: true, pid: dummy.pid }, null, 2), 'utf8');
      await fs.writeFile(pluginState, JSON.stringify({ running: true, pid: dummy.pid }, null, 2), 'utf8');

      const res = await runCli(['--json', '--remnote-db', remnoteDb, 'doctor', '--fix'], {
        env: {
          HOME: tmpHome,
          REMNOTE_TMUX_REFRESH: '0',
          REMNOTE_DAEMON_PID_FILE: daemonPid,
          REMNOTE_API_PID_FILE: apiPid,
          REMNOTE_API_STATE_FILE: apiState,
          REMNOTE_PLUGIN_SERVER_PID_FILE: pluginPid,
          REMNOTE_PLUGIN_SERVER_STATE_FILE: pluginState,
        },
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      const runtimeFix = (parsed.data?.fixes ?? []).find((item: any) => item.id === 'runtime.cleanup_stale_artifacts');
      expect(runtimeFix?.ok).toBe(true);
      expect(runtimeFix?.changed).toBe(true);

      await expect(fs.stat(daemonPid)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(apiPid)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(pluginPid)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(daemonState)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(apiState)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(pluginState)).rejects.toMatchObject({ code: 'ENOENT' });

      expect(() => process.kill(dummy.pid!, 0)).not.toThrow();
    } finally {
      try {
        dummy.kill('SIGKILL');
      } catch {}
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 40_000);

  it('reports invalid apiBaseUrl without rewriting config', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-doctor-fix-invalid-url-'));
    const tmpHome = path.join(tmpDir, 'home');
    const stateDir = path.join(tmpHome, '.agent-remnote');
    const remnoteDb = path.join(tmpDir, 'remnote.db');
    const configFile = path.join(stateDir, 'config.json');

    try {
      createMinimalRemnoteDb(remnoteDb);
      await fs.mkdir(stateDir, { recursive: true });

      const original = JSON.stringify({ apiBaseUrl: 'not-a-url', keepMe: true }, null, 2);
      await fs.writeFile(configFile, original, 'utf8');

      const res = await runCli(['--json', '--remnote-db', remnoteDb, 'doctor', '--fix'], {
        env: { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data?.overall_ok).toBe(false);
      const configCheck = (parsed.data?.checks ?? []).find((item: any) => item.id === 'config.migration_needed');
      expect(configCheck?.ok).toBe(false);
      expect(configCheck?.severity).toBe('error');
      expect(String(JSON.stringify(configCheck?.details ?? {}))).toContain('apiBaseUrl');
      const configFix = (parsed.data?.fixes ?? []).find((item: any) => item.id === 'config.rewrite_canonical_user_config');
      expect(configFix?.ok).toBe(false);
      expect(configFix?.changed).toBe(false);

      const current = await fs.readFile(configFile, 'utf8');
      expect(current.trim()).toBe(original.trim());
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 40_000);

  it('auto-restarts trusted live runtime mismatches and clears version mismatch diagnostics', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-doctor-fix-restart-'));
    const tmpHome = path.join(tmpDir, 'home');
    const stateDir = path.join(tmpHome, '.agent-remnote');
    const remnoteDb = path.join(tmpDir, 'remnote.db');
    const storeDb = path.join(tmpDir, 'store.sqlite');
    const daemonPid = path.join(stateDir, 'ws.pid');
    const daemonLog = path.join(stateDir, 'ws.log');
    const daemonUrl = `ws://127.0.0.1:${await getFreePort()}/ws`;
    const apiPid = path.join(stateDir, 'api.pid');
    const apiLog = path.join(stateDir, 'api.log');
    const apiState = path.join(stateDir, 'api.state.json');
    const apiPort = await getFreePort();
    const pluginPid = path.join(stateDir, 'plugin-server.pid');
    const pluginLog = path.join(stateDir, 'plugin-server.log');
    const pluginState = path.join(stateDir, 'plugin-server.state.json');
    const pluginPort = await getFreePort();
    const env = {
      HOME: tmpHome,
      REMNOTE_STORE_DB: storeDb,
      REMNOTE_TMUX_REFRESH: '0',
      REMNOTE_DAEMON_PID_FILE: daemonPid,
      REMNOTE_API_PID_FILE: apiPid,
      REMNOTE_API_STATE_FILE: apiState,
      REMNOTE_PLUGIN_SERVER_PID_FILE: pluginPid,
      REMNOTE_PLUGIN_SERVER_STATE_FILE: pluginState,
    } as const;

    try {
      createMinimalRemnoteDb(remnoteDb);
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(
        path.join(tmpHome, '.agent-remnote', 'fixed-owner-claim.json'),
        JSON.stringify(
          {
            claimed_channel: 'dev',
            claimed_owner_id: 'dev',
            runtime_root: stateDir,
            control_plane_root: path.join(tmpHome, '.agent-remnote'),
            port_class: 'canonical',
            updated_by: 'stack_takeover',
            updated_at: Date.now(),
            launcher_ref: `source:${stateDir}`,
          },
          null,
          2,
        ),
        'utf8',
      );

      const daemonStart = await runCli(['--json', '--daemon-url', daemonUrl, '--store-db', storeDb, 'daemon', 'start', '--wait', '0', '--pid-file', daemonPid, '--log-file', daemonLog], {
        env,
        timeoutMs: 20_000,
      });
      expect(daemonStart.exitCode).toBe(0);

      const apiStart = await runCli(
        ['--json', '--daemon-url', daemonUrl, '--store-db', storeDb, 'api', 'start', '--port', String(apiPort), '--pid-file', apiPid, '--log-file', apiLog, '--state-file', apiState],
        { env, timeoutMs: 20_000 },
      );
      expect(apiStart.exitCode).toBe(0);

      const pluginStart = await runCli(
        ['--json', 'plugin', 'start', '--port', String(pluginPort), '--pid-file', pluginPid, '--log-file', pluginLog, '--state-file', pluginState],
        { env, timeoutMs: 20_000 },
      );
      expect(pluginStart.exitCode).toBe(0);

      const daemonPidInfo = JSON.parse(await fs.readFile(daemonPid, 'utf8'));
      daemonPidInfo.build.build_id = 'old-daemon-build';
      await fs.writeFile(daemonPid, `${JSON.stringify(daemonPidInfo, null, 2)}\n`, 'utf8');

      const apiPidInfo = JSON.parse(await fs.readFile(apiPid, 'utf8'));
      apiPidInfo.build.build_id = 'old-api-build';
      await fs.writeFile(apiPid, `${JSON.stringify(apiPidInfo, null, 2)}\n`, 'utf8');

      const pluginPidInfo = JSON.parse(await fs.readFile(pluginPid, 'utf8'));
      pluginPidInfo.build.build_id = 'old-plugin-build';
      await fs.writeFile(pluginPid, `${JSON.stringify(pluginPidInfo, null, 2)}\n`, 'utf8');

      const pluginStateInfo = JSON.parse(await fs.readFile(pluginState, 'utf8'));
      pluginStateInfo.plugin_build.build_id = 'old-plugin-artifact';
      await fs.writeFile(pluginState, `${JSON.stringify(pluginStateInfo, null, 2)}\n`, 'utf8');

      const before = await runCli(
        ['--json', '--daemon-url', daemonUrl, '--store-db', storeDb, '--remnote-db', remnoteDb, 'doctor'],
        { env, timeoutMs: 30_000 },
      );
      expect(before.exitCode).toBe(0);
      const beforeParsed = JSON.parse(before.stdout.trim());
      const beforeMismatch = (beforeParsed.data?.checks ?? []).find((item: any) => item.id === 'runtime.version_mismatch');
      expect(beforeMismatch?.ok).toBe(false);
      expect(JSON.stringify(beforeMismatch?.details ?? [])).toContain('daemon');
      expect(JSON.stringify(beforeMismatch?.details ?? [])).toContain('api');
      expect(JSON.stringify(beforeMismatch?.details ?? [])).toContain('plugin');
      expect(JSON.stringify(beforeMismatch?.details ?? [])).toContain('plugin-artifact');

      const fix = await runCli(
        ['--json', '--daemon-url', daemonUrl, '--store-db', storeDb, '--remnote-db', remnoteDb, 'doctor', '--fix'],
        { env, timeoutMs: 60_000 },
      );
      expect(fix.exitCode).toBe(0);
      const fixParsed = JSON.parse(fix.stdout.trim());
      const restartFix = (fixParsed.data?.fixes ?? []).find((item: any) => item.id === 'runtime.restart_mismatched_services');
      expect(restartFix?.ok).toBe(true);
      expect(restartFix?.changed).toBe(true);
      expect(fixParsed.data?.restart_summary?.restarted).toEqual(expect.arrayContaining(['daemon', 'api', 'plugin']));

      const after = await runCli(
        ['--json', '--daemon-url', daemonUrl, '--store-db', storeDb, '--remnote-db', remnoteDb, 'doctor'],
        { env, timeoutMs: 30_000 },
      );
      expect(after.exitCode).toBe(0);
      const afterParsed = JSON.parse(after.stdout.trim());
      const afterMismatch = (afterParsed.data?.checks ?? []).find((item: any) => item.id === 'runtime.version_mismatch');
      expect(afterMismatch?.ok).toBe(true);
    } finally {
      try {
        await runCli(['--json', '--daemon-url', daemonUrl, '--store-db', storeDb, 'api', 'stop', '--pid-file', apiPid, '--state-file', apiState], {
          env,
          timeoutMs: 20_000,
        });
      } catch {}
      try {
        await runCli(['--json', 'plugin', 'stop', '--pid-file', pluginPid, '--state-file', pluginState], {
          env,
          timeoutMs: 20_000,
        });
      } catch {}
      try {
        await runCli(['--json', '--daemon-url', daemonUrl, '--store-db', storeDb, 'daemon', 'stop', '--force', '--pid-file', daemonPid], {
          env,
          timeoutMs: 20_000,
        });
      } catch {}
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 180_000);
});
