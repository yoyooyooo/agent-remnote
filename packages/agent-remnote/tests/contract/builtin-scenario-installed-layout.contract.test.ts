import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';

import { installPackedCli, packAgentRemnoteCli, runInstalledCli } from '../helpers/packedCli.js';

describe('cli contract: builtin scenarios work in installed package layout', () => {
  let packDir = '';
  let tarballPath = '';
  let installDir = '';
  let cliPath = '';
  let scenarioDir = '';

  beforeAll(async () => {
    const packed = await packAgentRemnoteCli();
    packDir = packed.workDir;
    tarballPath = packed.tarballPath;

    const installed = await installPackedCli(tarballPath);
    installDir = installed.installDir;
    cliPath = installed.cliPath;
    scenarioDir = `${installDir}/scenario-user`;
  }, 240_000);

  afterAll(async () => {
    await fs.rm(installDir, { recursive: true, force: true });
    await fs.rm(packDir, { recursive: true, force: true });
  });

  it('starts successfully and returns version output', async () => {
    const versionRes = await runInstalledCli({ cliPath, args: ['--version'], timeoutMs: 30_000 });

    expect(versionRes.exitCode).toBe(0);
    expect(versionRes.stderr).toBe('');
    expect(versionRes.stdout.trim()).toBe('1.4.0');

    const listRes = await runInstalledCli({ cliPath, args: ['--json', 'scenario', 'builtin', 'list'], timeoutMs: 30_000 });
    expect(listRes.exitCode).toBe(0);
    expect(listRes.stderr).toBe('');
    const parsed = JSON.parse(listRes.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(String(JSON.stringify(parsed.data))).toContain('dn_recent_todos_to_today_move');
    expect(String(JSON.stringify(parsed.data))).toContain('dn_recent_todos_to_today_portal');

    const installRes = await runInstalledCli({
      cliPath,
      args: ['--json', 'scenario', 'builtin', 'install', 'dn_recent_todos_to_today_move', '--dir', scenarioDir],
      timeoutMs: 30_000,
    });
    expect(installRes.exitCode).toBe(0);
    expect(installRes.stderr).toBe('');
    const installed = JSON.parse(installRes.stdout.trim());
    expect(installed.ok).toBe(true);
    expect(String(JSON.stringify(installed.data.installed))).toContain('dn_recent_todos_to_today_move');
    await expect(fs.stat(`${scenarioDir}/dn_recent_todos_to_today_move.json`)).resolves.toBeTruthy();
  });
});
