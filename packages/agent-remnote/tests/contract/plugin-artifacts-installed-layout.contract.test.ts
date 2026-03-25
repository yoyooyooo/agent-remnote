import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import { promises as fs } from 'node:fs';
import Database from 'better-sqlite3';

import { installPackedCli, packAgentRemnoteCli, runInstalledCli } from '../helpers/packedCli.js';

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

describe('cli contract: plugin artifacts in installed package layout', () => {
  let packDir = '';
  let tarballPath = '';
  let installDir = '';
  let cliPath = '';
  let port = 0;
  let remnoteDb = '';
  let storeDb = '';

  beforeAll(async () => {
    const packed = await packAgentRemnoteCli();
    packDir = packed.workDir;
    tarballPath = packed.tarballPath;

    const installed = await installPackedCli(tarballPath);
    installDir = installed.installDir;
    cliPath = installed.cliPath;
    port = await getFreePort();
    remnoteDb = `${installDir}/remnote.db`;
    storeDb = `${installDir}/store.sqlite`;
    createMinimalRemnoteDb(remnoteDb);
  }, 240_000);

  afterAll(async () => {
    await fs.rm(installDir, { recursive: true, force: true });
    await fs.rm(packDir, { recursive: true, force: true });
  });

  it('serves plugin artifacts from an installed package', async () => {
    const pidFile = `${installDir}/plugin.pid`;
    const logFile = `${installDir}/plugin.log`;
    const stateFile = `${installDir}/plugin.state.json`;

    const startRes = await runInstalledCli({
      cliPath,
      args: ['--json', 'plugin', 'start', '--port', String(port), '--pid-file', pidFile, '--log-file', logFile, '--state-file', stateFile],
      timeoutMs: 30_000,
    });
    expect(startRes.exitCode).toBe(0);
    expect(startRes.stderr).toBe('');
    const parsed = JSON.parse(startRes.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.base_url).toBe(`http://127.0.0.1:${port}`);

    const manifestRes = await fetch(`http://127.0.0.1:${port}/manifest.json`);
    expect(manifestRes.status).toBe(200);

    const stopRes = await runInstalledCli({
      cliPath,
      args: ['--json', 'plugin', 'stop', '--pid-file', pidFile, '--state-file', stateFile],
      timeoutMs: 30_000,
    });
    expect(stopRes.exitCode).toBe(0);
    expect(stopRes.stderr).toBe('');
    const stopped = JSON.parse(stopRes.stdout.trim());
    expect(stopped.ok).toBe(true);
    expect(stopped.data.stopped).toBe(true);
  });

  it('reports package checks from an installed package via doctor', async () => {
    const res = await runInstalledCli({
      cliPath,
      args: ['--json', '--remnote-db', remnoteDb, '--store-db', storeDb, '--daemon-url', 'ws://127.0.0.1:9/ws', 'doctor'],
      timeoutMs: 30_000,
    });
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    const packageCheck = (parsed.data?.checks ?? []).find((item: any) => item.id === 'package.builtin_scenarios_broken');
    expect(packageCheck?.ok).toBe(true);
    const pluginArtifactsCheck = (parsed.data?.checks ?? []).find(
      (item: any) => item.id === 'package.plugin_artifacts_unavailable',
    );
    expect(pluginArtifactsCheck?.ok).toBe(true);
  });
});
