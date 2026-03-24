import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { startJsonApiStub } from '../helpers/httpApiStub.js';
import { runCli } from '../helpers/runCli.js';
import {
  dnRecentTodosGenerateHint,
  dnRecentTodosPackages,
  dnRecentTodosToTodayPortalPackage,
  writeJsonFixture,
} from '../helpers/scenarioVerificationFixtures.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('contract: scenario schema tooling', () => {
  it.each(dnRecentTodosPackages.map((scenarioPackage) => [scenarioPackage.id, scenarioPackage] as const))(
    'keeps schema validation local under apiBaseUrl for %s',
    async (_scenarioId, scenarioPackage) => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-scenario-validate-'));
      const api = await startJsonApiStub(() => undefined);

      try {
        const packagePath = await writeJsonFixture(tmpDir, `${scenarioPackage.id}.json`, scenarioPackage);
        const res = await runCli(
          [
            '--json',
            '--api-base-url',
            api.baseUrl,
            'scenario',
            'schema',
            'validate',
            '--spec',
            `@${packagePath}`,
          ],
          { timeoutMs: 15_000 },
        );

        expect(res.exitCode).toBe(0);
        expect(res.stderr).toBe('');

        const parsed = parseJsonLine(res.stdout);
        expect(parsed.ok).toBe(true);
        expect(parsed.data).toMatchObject({
          ok: true,
          subcommand: 'validate',
        });
        expect(typeof parsed.data.tool).toBe('string');
        expect(typeof parsed.data.schema_version).toBe('number');
        expect(Array.isArray(parsed.data.errors)).toBe(true);
        expect(Array.isArray(parsed.data.warnings)).toBe(true);
        expect(Array.isArray(parsed.data.hints)).toBe(true);
        expect(api.requests).toHaveLength(0);
      } finally {
        await api.close();
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  );

  it('explains the portal package with host-independent previews', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-scenario-explain-'));

    try {
      const packagePath = await writeJsonFixture(tmpDir, 'portal-package.json', dnRecentTodosToTodayPortalPackage);
      const res = await runCli(
        ['--json', 'scenario', 'schema', 'explain', '--spec', `@${packagePath}`],
        { timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data).toMatchObject({
        ok: true,
        subcommand: 'explain',
      });
      expect(typeof parsed.data.summary).toBe('string');
      expect(Array.isArray(parsed.data.required_vars)).toBe(true);
      expect(
        parsed.data.required_vars.some((item: any) => item === 'target_ref' || item?.name === 'target_ref'),
      ).toBe(true);
      expect(parsed.data.selector_preview).toBeTruthy();
      expect(parsed.data.action_preview).toBeTruthy();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('generates a canonical draft from a structured hint', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-scenario-generate-'));

    try {
      const hintPath = await writeJsonFixture(tmpDir, 'hint.json', dnRecentTodosGenerateHint);
      const res = await runCli(
        ['--json', 'scenario', 'schema', 'generate', '--hint', `@${hintPath}`],
        { timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data).toMatchObject({
        ok: true,
        subcommand: 'generate',
      });
      expect(parsed.data.generated_package).toBeTruthy();
      expect(Array.isArray(parsed.data.assumptions)).toBe(true);
      expect(parsed.data.inputs_used).toBeTruthy();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
