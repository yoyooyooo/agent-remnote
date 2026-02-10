import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('cli contract: write table create', () => {
  it('write table create --dry-run --json emits create_table op (snake_case payload)', async () => {
    const res = await runCli([
      '--json',
      'table',
      'create',
      '--table-tag',
      'tag1',
      '--parent',
      'p1',
      '--position',
      '0',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.dry_run).toBe(true);

    const op = env.data.ops[0];
    expect(op.type).toBe('create_table');
    expect(op.payload.tag_id).toBe('tag1');
    expect(op.payload.parent_id).toBe('p1');
    expect(op.payload.position).toBe(0);
    expect(typeof op.payload.client_temp_id).toBe('string');
    expect(env.data.table_client_temp_id).toBe(op.payload.client_temp_id);
  });

  it('parses remnote:// deep links for table-tag', async () => {
    const res = await runCli([
      '--json',
      'table',
      'create',
      '--table-tag',
      'remnote://w/ws1/tag1',
      '--parent',
      'p1',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.dry_run).toBe(true);

    const op = env.data.ops[0];
    expect(op.type).toBe('create_table');
    expect(op.payload.tag_id).toBe('tag1');
  });
});
