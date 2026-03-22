import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';

import { runCli } from '../helpers/runCli.js';

async function withTmpDb(fn: (dbPath: string) => Promise<void>): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-powerup-todo-'));
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
      insert.run('R1', JSON.stringify({ key: ['Task 1'], tp: { T1: { t: 1 } } }));
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

describe('cli contract: powerup todo alias', () => {
  it('exposes powerup todo done as the canonical todo write path', async () => {
    await withTmpDb(async (dbPath) => {
      const res = await runCli([
        '--json',
        '--remnote-db',
        dbPath,
        'powerup',
        'todo',
        'done',
        '--rem',
        'R1',
        '--dry-run',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = JSON.parse(res.stdout.trim());
      expect(env.ok).toBe(true);
      expect(env.data.dry_run).toBe(true);
      expect(env.data.ops[0].type).toBe('add_tag');
      expect(env.data.ops[1].type).toBe('set_cell_select');
      expect(env.data.ops[1].payload.property_id).toBe('P1');
      expect(env.data.ops[1].payload.option_ids).toBe('O2');
    });
  });
});
