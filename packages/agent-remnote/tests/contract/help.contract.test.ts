import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE_RE, '');
}

describe('cli contract: --help', () => {
  it('prints root help with subcommands', async () => {
    const res = await runCli(['--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const out = stripAnsi(res.stdout);
    expect(out).toContain('agent-remnote');
    expect(out).toContain('daemon');
    expect(out).toContain('queue');
    expect(out).toMatch(/\n\s*-\s+apply\b/);
    expect(out).toMatch(/\n\s*-\s+plugin\b/);
    expect(out).toContain('plugin search');
    expect(out).toContain('search');
    expect(out).toContain('rem');
    expect(out).toContain('daily');
    expect(out).toContain('todo');
    expect(out).toContain('powerup');
    expect(out).toContain('table');
    expect(out).toContain('tag');
    expect(out).toContain('portal');
    expect(out).toContain('replace');
    expect(out).toContain('db');
    expect(out).not.toMatch(/\n\s*-\s+read\b/);
    expect(out).not.toMatch(/\n\s*-\s+write\b/);
    expect(out).not.toMatch(/\n\s*-\s+import\b/);
    expect(out).not.toMatch(/\n\s*-\s+plan\b/);
  });

  it('prints rem help with verbs', async () => {
    const res = await runCli(['rem', '--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const out = stripAnsi(res.stdout);
    expect(out).toContain('create');
    expect(out).toMatch(/\n\s*-\s+children\b/);
    expect(out).toContain('move');
    expect(out).toContain('text');
    expect(out).toContain('tag');
    expect(out).toContain('delete');
  });

  it('does not print duplicated command prefixes', async () => {
    const res = await runCli(['--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const out = stripAnsi(res.stdout);
    expect(out).not.toMatch(/\bread read\b/);
  });

  it('prints daemon help with subcommands', async () => {
    const res = await runCli(['daemon', '--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const out = stripAnsi(res.stdout);
    expect(out).toContain('health');
    expect(out).toContain('start');
    expect(out).toContain('stop');
    expect(out).toContain('status');
  });

  it('prints daily write help with markdown-friendly inputs', async () => {
    const res = await runCli(['daily', 'write', '--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const out = stripAnsi(res.stdout);
    expect(out).toContain('--markdown');
    expect(out).toContain('--force-text');
    expect(out).not.toMatch(/^\s+--stdin\b/m);
    expect(out).not.toMatch(/^\s+--md-file\b/m);
  });

  it('prints daily help with rem-id subcommand', async () => {
    const res = await runCli(['daily', '--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const out = stripAnsi(res.stdout);
    expect(out).toContain('summary');
    expect(out).toContain('rem-id');
    expect(out).toContain('write');
  });

  it('prints ui-context help with subcommands', async () => {
    const res = await runCli(['plugin', 'ui-context', '--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const out = stripAnsi(res.stdout);
    expect(out).toContain('snapshot');
    expect(out).toContain('page');
    expect(out).toContain('focused-rem');
    expect(out).toContain('describe');
  });

  it('prints config help with subcommands', async () => {
    const res = await runCli(['config', '--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const out = stripAnsi(res.stdout);
    expect(out).toContain('print');
    expect(out).toContain('path');
    expect(out).toContain('list');
    expect(out).toContain('get');
    expect(out).toContain('set');
    expect(out).toContain('unset');
    expect(out).toContain('validate');
  });
});
