import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE_RE, '');
}

describe('cli contract: api/stack help', () => {
  it('prints api help with lifecycle subcommands', async () => {
    const res = await runCli(['api', '--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const out = stripAnsi(res.stdout);
    expect(out).toContain('serve');
    expect(out).toContain('start');
    expect(out).toContain('stop');
    expect(out).toContain('status');
    expect(out).toContain('logs');
    expect(out).toContain('restart');
    expect(out).toContain('ensure');
  });

  it('prints stack help with orchestration subcommands', async () => {
    const res = await runCli(['stack', '--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const out = stripAnsi(res.stdout);
    expect(out).toContain('ensure');
    expect(out).toContain('stop');
    expect(out).toContain('status');
    expect(out).toContain('takeover');
  });
});
