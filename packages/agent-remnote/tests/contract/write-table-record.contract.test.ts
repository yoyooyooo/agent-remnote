import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import Database from 'better-sqlite3';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

function createMinimalRemnoteDb(dbPath: string) {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS quanta (
        _id TEXT PRIMARY KEY,
        doc TEXT NOT NULL
      );
    `);

    const insert = db.prepare('INSERT INTO quanta (_id, doc) VALUES (?, ?)');

    const tagId = 't1';
    const propertyId = 'p_status';
    const optionId = 'o_todo';

    insert.run(tagId, JSON.stringify({ _id: tagId, key: ['Table'], type: 1 }));
    insert.run(
      propertyId,
      JSON.stringify({
        _id: propertyId,
        parent: tagId,
        key: ['Status'],
        rcrs: 'property.s',
        f: 'a0',
        type: 1,
      }),
    );
    insert.run(
      optionId,
      JSON.stringify({
        _id: optionId,
        parent: propertyId,
        key: ['Todo'],
        rcre: 't.s',
        pd: '{}',
        f: 'a0',
        type: 1,
      }),
    );

    return { tagId, propertyId, optionId };
  } finally {
    db.close();
  }
}

describe('cli contract: write table record', () => {
  it('write table record add supports --dry-run --json and defaults location to daily:today', async () => {
    const res = await runCli(['--json', 'table', 'record', 'add', '--table-tag', 't1', '--dry-run']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.dry_run).toBe(true);
    expect(typeof env.data?.row_client_temp_id).toBe('string');
    expect(String(env.data.row_client_temp_id)).toMatch(/^tmp:/);
    expect(Array.isArray(env.data?.ops)).toBe(true);

    const op0 = env.data.ops[0];
    expect(op0.type).toBe('table_add_row');
    expect(op0.payload.table_tag_id).toBe('t1');
    expect(op0.payload.parent_id).toBe('daily:today');
    expect(op0.payload.client_temp_id).toBe(env.data.row_client_temp_id);
  });

  it('rejects non-array --values with a stable error.code in --json mode', async () => {
    const res = await runCli([
      '--json',
      'table',
      'record',
      'add',
      '--table-tag',
      't1',
      '--dry-run',
      '--values',
      '{"foo":1}',
    ]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INVALID_ARGS');
  });

  it('compiles select values (optionName -> optionId) when REMNOTE_DB is provided', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const dbPath = path.join(tmpDir, 'remnote.db');

    try {
      const { tagId, propertyId, optionId } = createMinimalRemnoteDb(dbPath);
      const values = JSON.stringify([{ propertyName: 'Status', value: 'Todo' }]);

      const res = await runCli(
        [
          '--json',
          'table',
          'record',
          'add',
          '--table-tag',
          tagId,
          '--parent',
          'p1',
          '--dry-run',
          '--values',
          values,
        ],
        { env: { HOME: tmpHome, REMNOTE_DB: dbPath, REMNOTE_TMUX_REFRESH: '0' } },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);
      expect(env.data?.dry_run).toBe(true);
      expect(Array.isArray(env.data?.ops)).toBe(true);
      expect(env.data.ops.length).toBe(2);

      const rowClientTempId = String(env.data.row_client_temp_id);

      const op0 = env.data.ops[0];
      expect(op0.type).toBe('table_add_row');
      expect(op0.payload.table_tag_id).toBe(tagId);
      expect(op0.payload.parent_id).toBe('p1');
      expect(op0.payload.client_temp_id).toBe(rowClientTempId);

      const op1 = env.data.ops[1];
      expect(op1.type).toBe('set_cell_select');
      expect(op1.payload.rem_id).toBe(rowClientTempId);
      expect(op1.payload.property_id).toBe(propertyId);
      expect(op1.payload.option_ids).toBe(optionId);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('write table record update --dry-run --json emits update_text op', async () => {
    const res = await runCli([
      '--json',
      'table',
      'record',
      'update',
      '--table-tag',
      't1',
      '--row',
      'r1',
      '--text',
      'hello',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.dry_run).toBe(true);
    expect(env.data?.ops?.[0]?.type).toBe('update_text');
    expect(env.data.ops[0].payload.rem_id).toBe('r1');
    expect(env.data.ops[0].payload.text).toBe('hello');
  });

  it('write table record delete --dry-run --json emits delete_rem op', async () => {
    const res = await runCli([
      '--json',
      'table',
      'record',
      'delete',
      '--table-tag',
      't1',
      '--row',
      'r1',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.dry_run).toBe(true);
    expect(env.data?.ops?.[0]?.type).toBe('delete_rem');
    expect(env.data.ops[0].payload.rem_id).toBe('r1');
  });
});
