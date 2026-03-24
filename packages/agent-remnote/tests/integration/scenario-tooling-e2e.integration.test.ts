import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';
import { dnRecentTodosGenerateHint, writeJsonFixture } from '../helpers/scenarioVerificationFixtures.js';

const SCENARIO_TOOLING_E2E_TEST_TIMEOUT_MS = 45_000;

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('integration: scenario schema tooling e2e', () => {
  it('roundtrips structured generate output through normalize and validate', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-scenario-e2e-'));

    try {
      const hintPath = await writeJsonFixture(tmpDir, 'hint.json', dnRecentTodosGenerateHint);
      const generateRes = await runCli(
        ['--json', 'scenario', 'schema', 'generate', '--hint', `@${hintPath}`],
        { timeoutMs: 15_000 },
      );

      expect(generateRes.exitCode).toBe(0);
      expect(generateRes.stderr).toBe('');
      const generated = parseJsonLine(generateRes.stdout);
      expect(generated.ok).toBe(true);
      expect(generated.data.generated_package).toBeTruthy();

      const generatedPackagePath = await writeJsonFixture(tmpDir, 'generated-package.json', generated.data.generated_package);
      const normalizeRes = await runCli(
        ['--json', 'scenario', 'schema', 'normalize', '--spec', `@${generatedPackagePath}`],
        { timeoutMs: 15_000 },
      );

      expect(normalizeRes.exitCode).toBe(0);
      expect(normalizeRes.stderr).toBe('');
      const normalized = parseJsonLine(normalizeRes.stdout);
      expect(normalized.ok).toBe(true);
      expect(normalized.data).toMatchObject({
        ok: true,
        subcommand: 'normalize',
      });
      expect(normalized.data.normalized_package).toBeTruthy();

      const normalizedPackagePath = await writeJsonFixture(
        tmpDir,
        'normalized-package.json',
        normalized.data.normalized_package,
      );
      const validateRes = await runCli(
        ['--json', 'scenario', 'schema', 'validate', '--spec', `@${normalizedPackagePath}`],
        { timeoutMs: 15_000 },
      );

      expect(validateRes.exitCode).toBe(0);
      expect(validateRes.stderr).toBe('');
      const validated = parseJsonLine(validateRes.stdout);
      expect(validated.ok).toBe(true);
      expect(validated.data).toMatchObject({
        ok: true,
        subcommand: 'validate',
      });
      expect(validated.data.errors).toEqual([]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, SCENARIO_TOOLING_E2E_TEST_TIMEOUT_MS);
});
