import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('cli contract: write portal create', () => {
  it('write portal create --dry-run --json emits create_portal op (snake_case payload)', async () => {
    const res = await runCli([
      '--json',
      'portal',
      'create',
      '--to',
      'id:t1',
      '--at',
      'parent[2]:id:p1',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.dry_run).toBe(true);

    const op = env.data.ops[0];
    expect(op.type).toBe('create_portal');
    expect(op.payload.parent_id).toBe('p1');
    expect(op.payload.target_rem_id).toBe('t1');
    expect(op.payload.position).toBe(2);
    expect(typeof op.payload.client_temp_id).toBe('string');
    expect(env.data.portal_client_temp_id).toBe(op.payload.client_temp_id);
  });

  it('parses remnote:// deep links for parent/target', async () => {
    const res = await runCli([
      '--json',
      'portal',
      'create',
      '--to',
      'remnote://w/ws1/t1',
      '--at',
      'parent:remnote://w/ws1/p1',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.dry_run).toBe(true);

    const op = env.data.ops[0];
    expect(op.type).toBe('create_portal');
    expect(op.payload.parent_id).toBe('p1');
    expect(op.payload.target_rem_id).toBe('t1');
  });
});
