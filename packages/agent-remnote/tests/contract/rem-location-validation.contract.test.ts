import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('cli contract: rem create/move location validation', () => {
  it('fails fast when multiple content placement groups are combined', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'create',
      '--parent',
      'p1',
      '--standalone',
      '--text',
      'hello',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INVALID_ARGS');
    expect(String(env.error?.message ?? '')).toContain('placement');
  });

  it('fails fast when multiple portal placement groups are combined', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'create',
      '--standalone',
      '--title',
      'LangGraph',
      '--markdown',
      '- Overview',
      '--portal-parent',
      'p1',
      '--portal-after',
      'a1',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INVALID_ARGS');
    expect(String(env.error?.message ?? '')).toContain('portal placement');
  });

  it('fails fast when no destination placement is provided', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'create',
      '--title',
      'LangGraph',
      '--markdown',
      '- Overview',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INVALID_ARGS');
    expect(String(env.error?.message ?? '')).toContain('placement');
  });
});
