import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('cli contract: write powerup property runtime guard', () => {
  it('write powerup property add rejects typed property creation with a stable error.code in --json mode', async () => {
    const res = await runCli([
      '--json',
      'powerup',
      'property',
      'add',
      '--tag-id',
      'p1',
      '--name',
      'Status',
      '--type',
      'single_select',
      '--options',
      '["Todo","Done"]',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('WRITE_UNAVAILABLE');
    expect(env.error?.message).toContain('Typed property creation');
  });

  it('write powerup property set-type rejects with a stable error.code in --json mode', async () => {
    const res = await runCli([
      '--json',
      'powerup',
      'property',
      'set-type',
      '--property',
      'prop1',
      '--type',
      'text',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('WRITE_UNAVAILABLE');
    expect(env.error?.message).toContain('Property type mutation');
  });
});
