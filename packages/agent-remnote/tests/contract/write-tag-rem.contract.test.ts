import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('cli contract: write tag/rem', () => {
  it('write tag add --dry-run --json emits add_tag op (snake_case payload)', async () => {
    const res = await runCli(['--json', 'tag', 'add', '--rem', 'r1', '--tag', 't1', '--dry-run']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.dry_run).toBe(true);
    expect(env.data.ops[0].type).toBe('add_tag');
    expect(env.data.ops[0].payload.rem_id).toBe('r1');
    expect(env.data.ops[0].payload.tag_id).toBe('t1');
  });

  it('write rem tag add --dry-run --json matches write tag add (including deeplink parsing)', async () => {
    const remLink = 'remnote://w/ws1/r1';
    const tagLink = 'remnote://w/ws1/t1';
    const tagRes = await runCli(['--json', 'tag', 'add', '--rem', remLink, '--tag', tagLink, '--dry-run']);
    const remRes = await runCli(['--json', 'rem', 'tag', 'add', '--rem', remLink, '--tag', tagLink, '--dry-run']);

    expect(tagRes.exitCode).toBe(0);
    expect(tagRes.stderr).toBe('');
    expect(remRes.exitCode).toBe(0);
    expect(remRes.stderr).toBe('');

    const tagEnv = parseJsonLine(tagRes.stdout);
    const remEnv = parseJsonLine(remRes.stdout);

    expect(tagEnv.ok).toBe(true);
    expect(remEnv.ok).toBe(true);
    expect(tagEnv.data?.dry_run).toBe(true);
    expect(remEnv.data?.dry_run).toBe(true);

    expect(tagEnv.data.ops[0]).toEqual(remEnv.data.ops[0]);
    expect(remEnv.data.ops[0].type).toBe('add_tag');
    expect(remEnv.data.ops[0].payload.rem_id).toBe('r1');
    expect(remEnv.data.ops[0].payload.tag_id).toBe('t1');
  });

  it('write tag remove --dry-run --json emits remove_tag op (remove_properties)', async () => {
    const res = await runCli([
      '--json',
      'tag',
      'remove',
      '--rem',
      'r1',
      '--tag',
      't1',
      '--remove-properties',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.dry_run).toBe(true);
    expect(env.data.ops[0].type).toBe('remove_tag');
    expect(env.data.ops[0].payload.rem_id).toBe('r1');
    expect(env.data.ops[0].payload.tag_id).toBe('t1');
    expect(env.data.ops[0].payload.remove_properties).toBe(true);
  });

  it('write rem tag remove --dry-run --json matches write tag remove', async () => {
    const tagRes = await runCli([
      '--json',
      'tag',
      'remove',
      '--rem',
      'r1',
      '--tag',
      't1',
      '--remove-properties',
      '--dry-run',
    ]);

    const remRes = await runCli([
      '--json',
      'rem',
      'tag',
      'remove',
      '--rem',
      'r1',
      '--tag',
      't1',
      '--remove-properties',
      '--dry-run',
    ]);

    expect(tagRes.exitCode).toBe(0);
    expect(tagRes.stderr).toBe('');
    expect(remRes.exitCode).toBe(0);
    expect(remRes.stderr).toBe('');

    const tagEnv = parseJsonLine(tagRes.stdout);
    const remEnv = parseJsonLine(remRes.stdout);

    expect(tagEnv.ok).toBe(true);
    expect(remEnv.ok).toBe(true);
    expect(tagEnv.data?.dry_run).toBe(true);
    expect(remEnv.data?.dry_run).toBe(true);

    expect(tagEnv.data.ops[0]).toEqual(remEnv.data.ops[0]);
    expect(remEnv.data.ops[0].type).toBe('remove_tag');
    expect(remEnv.data.ops[0].payload.rem_id).toBe('r1');
    expect(remEnv.data.ops[0].payload.tag_id).toBe('t1');
    expect(remEnv.data.ops[0].payload.remove_properties).toBe(true);
  });

  it('write rem delete --dry-run --json emits delete_rem op', async () => {
    const res = await runCli(['--json', 'rem', 'delete', '--rem', 'r1', '--dry-run']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.dry_run).toBe(true);
    expect(env.data.ops[0].type).toBe('delete_rem');
    expect(env.data.ops[0].payload.rem_id).toBe('r1');
  });

  it('write rem delete --max-delete-subtree-nodes --dry-run --json emits delete_rem op with dynamic subtree threshold', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'delete',
      '--rem',
      'r1',
      '--max-delete-subtree-nodes',
      '77',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.dry_run).toBe(true);
    expect(env.data.ops[0].type).toBe('delete_rem');
    expect(env.data.ops[0].payload.rem_id).toBe('r1');
    expect(env.data.ops[0].payload.max_delete_subtree_nodes).toBe(77);
  });
});
