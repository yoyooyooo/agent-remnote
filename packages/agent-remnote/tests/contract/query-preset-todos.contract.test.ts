import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';

import { runCli } from '../helpers/runCli.js';

async function withTmpDb(fn: (dbPath: string) => Promise<void>): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-query-preset-test-'));
  const dbPath = path.join(tmpDir, 'remnote.db');
  try {
    const db = new BetterSqlite3(dbPath);
    try {
      db.exec('CREATE TABLE quanta(_id TEXT PRIMARY KEY, doc TEXT NOT NULL);');
      db.exec(
        'CREATE TABLE remsSearchInfos(id TEXT PRIMARY KEY, aliasId TEXT, doc TEXT, ancestor_not_ref_text TEXT, ancestor_ids TEXT, freqCounter INTEGER, freqTime INTEGER);',
      );
      const insert = db.prepare('INSERT INTO quanta(_id, doc) VALUES(?, ?)');
      const insertSearch = db.prepare(
        'INSERT INTO remsSearchInfos(id, aliasId, doc, ancestor_not_ref_text, ancestor_ids, freqCounter, freqTime) VALUES(?, ?, ?, ?, ?, ?, ?)',
      );

      insert.run('T1', JSON.stringify({ key: ['Todo'], rcrt: 't', createdAt: 1000 }));
      insert.run('P1', JSON.stringify({ key: ['Status'], parent: 'T1', rcrs: 't.s', f: 0 }));
      insert.run('O1', JSON.stringify({ key: ['Unfinished'], parent: 'P1', rcre: 't.s', f: 0 }));
      insert.run('O2', JSON.stringify({ key: ['Finished'], parent: 'P1', rcre: 't.s', f: 1 }));
      insert.run(
        'R1',
        JSON.stringify({
          key: ['Task 1'],
          tp: { T1: { t: 1 } },
          createdAt: '1700000000000',
          u: '1700000001000',
          m: '1700000000500',
        }),
      );
      insert.run(
        'C1',
        JSON.stringify({
          parent: 'R1',
          key: [{ i: 'q', _id: 'P1' }],
          type: 2,
          value: [{ i: 'q', _id: 'O1' }],
        }),
      );
      insertSearch.run('R1', 'R1', JSON.stringify({ kt: 'Task 1' }), null, null, 0, 0);
    } finally {
      db.close();
    }

    await fn(dbPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe('cli contract: query preset todos.list', () => {
  it('maps todos.list semantics onto query --preset in local mode', async () => {
    await withTmpDb(async (dbPath) => {
      const localTodo = await runCli([
        '--json',
        '--remnote-db',
        dbPath,
        'todo',
        'list',
        '--status',
        'all',
        '--sort',
        'updatedAtDesc',
        '--limit',
        '20',
      ]);
      const presetQuery = await runCli([
        '--json',
        '--remnote-db',
        dbPath,
        'query',
        '--preset',
        'todos.list',
        '--status',
        'all',
        '--sort',
        'updatedAtDesc',
        '--limit',
        '20',
      ]);

      expect(localTodo.exitCode).toBe(0);
      expect(presetQuery.exitCode).toBe(0);
      expect(localTodo.stderr).toBe('');
      expect(presetQuery.stderr).toBe('');

      const todoEnv = JSON.parse(localTodo.stdout.trim());
      const presetEnv = JSON.parse(presetQuery.stdout.trim());
      expect(presetEnv.ok).toBe(true);
      expect(presetEnv.data.items).toEqual(todoEnv.data.items);
      expect(presetEnv.data.totalMatched).toBe(todoEnv.data.totalMatched);
    });
  });

  it('keeps query --preset todos.list on a stable remote refusal until preset parity is promoted', async () => {
    const res = await runCli(
      ['--json', '--api-base-url', 'http://127.0.0.1:1', 'query', '--preset', 'todos.list'],
      { timeoutMs: 15_000 },
    );

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_ARGS');
    expect(String(parsed.error.message)).toContain('query --preset todos.list is unavailable when apiBaseUrl is configured');
  });

  it('rejects preset-only flags when --preset is missing', async () => {
    const res = await runCli(['--json', 'query', '--status', 'all'], { timeoutMs: 15_000 });

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_ARGS');
    expect(parsed.error.message).toBe('--status requires --preset todos.list');
  });
});
