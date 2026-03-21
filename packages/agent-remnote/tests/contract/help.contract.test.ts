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
    expect(out).toContain('backup');
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
    expect(out).toContain('replace');
    expect(out).toContain('create');
    expect(out).toMatch(/\n\s*-\s+children\b/);
    expect(out).toContain('move');
    expect(out).toContain('set-text');
    expect(out).not.toMatch(/\n\s*-\s+text\b/);
    expect(out).toContain('tag');
    expect(out).toContain('delete');
  });

  it('prints rem create help with the reset axes', async () => {
    const res = await runCli(['rem', 'create', '--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const out = stripAnsi(res.stdout);
    expect(out).toContain('--from');
    expect(out).toContain('--from-selection');
    expect(out).toContain('--at');
    expect(out).toContain('--portal');
    expect(out).not.toContain('--target');
    expect(out).not.toContain('--parent');
    expect(out).not.toContain('--standalone');
    expect(out).toContain('Create a new durable subject');
    expect(out).toContain('Examples: standalone, parent:id:P1, parent[2]:id:P1');
    expect(out).toContain('Preferred default for --portal in-place');
    expect(out).toContain('Advanced path');
  });

  it('prints rem move help with subject/at/portal', async () => {
    const res = await runCli(['rem', 'move', '--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const out = stripAnsi(res.stdout);
    expect(out).toContain('--subject');
    expect(out).toContain('--at');
    expect(out).toContain('--portal');
    expect(out).not.toContain('--rem');
    expect(out).not.toContain('--leave-portal');
    expect(out).toContain('Move an existing durable subject');
    expect(out).toContain('Use in-place to leave a portal at the original location');
  });

  it('prints portal create help with to/at', async () => {
    const res = await runCli(['portal', 'create', '--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const out = stripAnsi(res.stdout);
    expect(out).toContain('--to');
    expect(out).toContain('--at');
    expect(out).not.toContain('--target');
    expect(out).not.toContain('--parent');
    expect(out).toContain('Create one portal relation');
    expect(out).toContain('standalone is invalid for portal placement');
  });

  it('prints tag add help with tag/to relation surface', async () => {
    const res = await runCli(['tag', 'add', '--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const out = stripAnsi(res.stdout);
    expect(out).toContain('--tag');
    expect(out).toContain('--to');
    expect(out).not.toContain('--subject');
    expect(out).not.toContain('--rem');
    expect(out).toContain('Relation write');
    expect(out).toContain('cross-product');
    expect(out).toContain('not pairwise');
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

  it('prints plugin help with serve', async () => {
    const res = await runCli(['plugin', '--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const out = stripAnsi(res.stdout);
    expect(out).toContain('current');
    expect(out).toContain('search');
    expect(out).toContain('serve');
    expect(out).toContain('start');
    expect(out).toContain('ensure');
    expect(out).toContain('status');
    expect(out).toContain('stop');
    expect(out).toContain('logs');
    expect(out).toContain('restart');
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
