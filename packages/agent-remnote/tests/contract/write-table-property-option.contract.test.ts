import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('cli contract: write table property/option', () => {
  it('write table property add --dry-run --json emits add_property op', async () => {
    const res = await runCli([
      '--json',
      'table',
      'property',
      'add',
      '--table-tag',
      't1',
      '--name',
      'Status',
      '--type',
      'select',
      '--options',
      '["Todo","Done"]',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.dry_run).toBe(true);
    expect(env.data.ops[0].type).toBe('add_property');
    expect(env.data.ops[0].payload.tag_id).toBe('t1');
    expect(env.data.ops[0].payload.name).toBe('Status');
    expect(env.data.ops[0].payload.type).toBe('select');
    expect(env.data.ops[0].payload.options).toEqual(['Todo', 'Done']);
  });

  it('write table property set-type --dry-run --json emits set_property_type op', async () => {
    const res = await runCli([
      '--json',
      'table',
      'property',
      'set-type',
      '--property',
      'p1',
      '--type',
      'text',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.dry_run).toBe(true);
    expect(env.data.ops[0].type).toBe('set_property_type');
    expect(env.data.ops[0].payload.property_id).toBe('p1');
    expect(env.data.ops[0].payload.type).toBe('text');
  });

  it('write table option add/remove --dry-run --json emits add_option/remove_option ops', async () => {
    const addRes = await runCli([
      '--json',
      'table',
      'option',
      'add',
      '--property',
      'p1',
      '--text',
      'Todo',
      '--dry-run',
    ]);

    expect(addRes.exitCode).toBe(0);
    expect(addRes.stderr).toBe('');

    const addEnv = parseJsonLine(addRes.stdout);
    expect(addEnv.ok).toBe(true);
    expect(addEnv.data?.dry_run).toBe(true);
    expect(addEnv.data.ops[0].type).toBe('add_option');
    expect(addEnv.data.ops[0].payload.property_id).toBe('p1');
    expect(addEnv.data.ops[0].payload.text).toBe('Todo');

    const rmRes = await runCli(['--json', 'table', 'option', 'remove', '--option', 'o1', '--dry-run']);
    expect(rmRes.exitCode).toBe(0);
    expect(rmRes.stderr).toBe('');

    const rmEnv = parseJsonLine(rmRes.stdout);
    expect(rmEnv.ok).toBe(true);
    expect(rmEnv.data?.dry_run).toBe(true);
    expect(rmEnv.data.ops[0].type).toBe('remove_option');
    expect(rmEnv.data.ops[0].payload.option_id).toBe('o1');
  });
});
