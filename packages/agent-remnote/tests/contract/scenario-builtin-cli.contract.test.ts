import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { startJsonApiStub } from '../helpers/httpApiStub.js';
import { runCli } from '../helpers/runCli.js';
import { dnRecentTodosToTodayPortalPackage } from '../helpers/scenarioVerificationFixtures.js';

describe('cli contract: scenario builtin', () => {
  it('prints scenario help with schema, builtin, and run surfaces', async () => {
    const res = await runCli(['scenario', '--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    expect(res.stdout).toContain('schema');
    expect(res.stdout).toContain('builtin');
    expect(res.stdout).toContain('run');
  });

  it('lists builtin scenarios with the default install directory', async () => {
    const res = await runCli(['--json', 'scenario', 'builtin', 'list']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.install_dir_default).toContain(path.join('.agent-remnote', 'scenarios'));
    expect(parsed.data.entries.map((entry: { id: string }) => entry.id)).toEqual([
      'dn_recent_todos_to_today_move',
      'dn_recent_todos_to_today_portal',
    ]);
  });

  it('installs builtin scenario files and skips existing files with --if-missing', async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-scenario-home-'));

    try {
      const first = await runCli(['--json', 'scenario', 'builtin', 'install', 'dn_recent_todos_to_today_move'], {
        env: { HOME: homeDir },
      });

      expect(first.exitCode).toBe(0);
      expect(first.stderr).toBe('');

      const firstParsed = JSON.parse(first.stdout.trim());
      expect(firstParsed.ok).toBe(true);
      expect(firstParsed.data.installed).toHaveLength(1);
      expect(firstParsed.data.skipped).toHaveLength(0);

      const installedPath = path.join(homeDir, '.agent-remnote', 'scenarios', 'dn_recent_todos_to_today_move.json');
      const installedRaw = await fs.readFile(installedPath, 'utf8');
      const installedPackage = JSON.parse(installedRaw);
      expect(installedPackage.id).toBe('dn_recent_todos_to_today_move');

      const second = await runCli(['--json', 'scenario', 'builtin', 'install', 'dn_recent_todos_to_today_move', '--if-missing'], {
        env: { HOME: homeDir },
      });

      expect(second.exitCode).toBe(0);
      expect(second.stderr).toBe('');

      const secondParsed = JSON.parse(second.stdout.trim());
      expect(secondParsed.ok).toBe(true);
      expect(secondParsed.data.installed).toHaveLength(0);
      expect(secondParsed.data.skipped).toEqual([
        {
          id: 'dn_recent_todos_to_today_move',
          path: installedPath,
          reason: 'exists',
        },
      ]);
    } finally {
      await fs.rm(homeDir, { recursive: true, force: true });
    }
  });

  it('runs an installed builtin scenario via the user: package spec', async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-scenario-home-'));
    const api = await startJsonApiStub((request) => {
      if (request.method === 'POST' && request.url === '/v1/read/query') {
        return {
          payload: {
            ok: true,
            data: {
              totalMatched: 1,
              items: [{ id: 'RID-U1', title: 'User Scenario Todo' }],
            },
          },
        };
      }

      return undefined;
    });

    try {
      const install = await runCli(
        ['--json', 'scenario', 'builtin', 'install', 'dn_recent_todos_to_today_portal'],
        { env: { HOME: homeDir } },
      );
      expect(install.exitCode).toBe(0);

      const res = await runCli(
        [
          '--json',
          '--api-base-url',
          api.baseUrl,
          'scenario',
          'run',
          '--package',
          'user:dn_recent_todos_to_today_portal',
          '--dry-run',
        ],
        { env: { HOME: homeDir }, timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.phase).toBe('compiled');
      expect(parsed.data.plan.compiled_execution.envelope.actions).toEqual([
        {
          action: 'portal.create',
          input: {
            parent_id: 'daily:today',
            target_rem_id: 'RID-U1',
          },
        },
      ]);
    } finally {
      await api.close();
      await fs.rm(homeDir, { recursive: true, force: true });
    }
  });

  it('falls back to the user scenario store for bare non-builtin ids', async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-scenario-home-'));
    const api = await startJsonApiStub((request) => {
      if (request.method === 'POST' && request.url === '/v1/read/query') {
        return {
          payload: {
            ok: true,
            data: {
              totalMatched: 1,
              items: [{ id: 'RID-C1', title: 'Custom Scenario Todo' }],
            },
          },
        };
      }

      return undefined;
    });

    try {
      const scenarioDir = path.join(homeDir, '.agent-remnote', 'scenarios');
      await fs.mkdir(scenarioDir, { recursive: true });
      const customPackage = {
        ...dnRecentTodosToTodayPortalPackage,
        id: 'custom_recent_todos_portal',
        meta: {
          ...dnRecentTodosToTodayPortalPackage.meta,
          owner: 'user',
          title: 'Custom recent todos portal',
        },
      };
      await fs.writeFile(
        path.join(scenarioDir, 'custom_recent_todos_portal.json'),
        `${JSON.stringify(customPackage, null, 2)}\n`,
        'utf8',
      );

      const res = await runCli(
        [
          '--json',
          '--api-base-url',
          api.baseUrl,
          'scenario',
          'run',
          '--package',
          'custom_recent_todos_portal',
          '--dry-run',
        ],
        { env: { HOME: homeDir }, timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.phase).toBe('compiled');
      expect(api.requests).toHaveLength(1);
      expect(api.requests[0]?.url).toBe('/v1/read/query');
    } finally {
      await api.close();
      await fs.rm(homeDir, { recursive: true, force: true });
    }
  });

  it('rejects the removed --id flag for builtin install', async () => {
    const res = await runCli(['--json', 'scenario', 'builtin', 'install', '--id', 'dn_recent_todos_to_today_move']);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_ARGS');
  });
});
