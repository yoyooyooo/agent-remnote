import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('cli contract: rem create/move location validation', () => {
  it('fails fast when --at is malformed', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'create',
      '--at',
      'parent[]:id:p1',
      '--text',
      'hello',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INVALID_ARGS');
    expect(String(env.error?.message ?? '')).toContain('--at');
  });

  it('fails fast when portal strategy points at standalone', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'create',
      '--at',
      'standalone',
      '--title',
      'LangGraph',
      '--markdown',
      '- Overview',
      '--portal',
      'at:standalone',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INVALID_ARGS');
    expect(String(env.error?.message ?? '')).toContain('standalone');
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
    expect(String(env.error?.message ?? '')).toContain('--at');
  });
});
