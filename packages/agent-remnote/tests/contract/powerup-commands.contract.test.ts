import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';

import { runCli } from '../helpers/runCli.js';

async function withTmpDb(fn: (dbPath: string) => Promise<void>): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-powerup-test-'));
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

      // Powerup header tag
      insert.run('T1', JSON.stringify({ key: ['Todo'], rcrt: 't', createdAt: 1000 }));

      // Properties
      insert.run('P1', JSON.stringify({ key: ['Status'], parent: 'T1', rcrs: 't.s', f: 0 }));
      insert.run('P2', JSON.stringify({ key: ['Due'], parent: 'T1', rcrs: 't.d', f: 1 }));

      // Options for Status (select)
      insert.run('O1', JSON.stringify({ key: ['Unfinished'], parent: 'P1', rcre: 't.s', f: 0 }));
      insert.run('O2', JSON.stringify({ key: ['Finished'], parent: 'P1', rcre: 't.s', f: 1 }));

      // Minimal Todo row + Status cell (no option.pd mapping; must be reverse-looked up)
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

describe('cli contract: powerup resolve/schema', () => {
  it('read powerup resolve --json resolves by title', async () => {
    await withTmpDb(async (dbPath) => {
      const res = await runCli(['--json', '--remnote-db', dbPath, 'powerup', 'resolve', '--powerup', 'Todo']);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = JSON.parse(res.stdout.trim());
      expect(env.ok).toBe(true);
      expect(env.data.id).toBe('T1');
      expect(env.data.title).toBe('Todo');
      expect(env.data.rcrt).toBe('t');
    });
  });

  it('read powerup schema --json resolves by --powerup and includes options', async () => {
    await withTmpDb(async (dbPath) => {
      const res = await runCli([
        '--json',
        '--remnote-db',
        dbPath,
        'powerup',
        'schema',
        '--powerup',
        'Todo',
        '--include-options',
        '--limit',
        '1',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = JSON.parse(res.stdout.trim());
      expect(env.ok).toBe(true);
      expect(env.data.tagId).toBe('T1');
      expect(env.data.tagName).toBe('Todo');
      expect(env.data.properties.map((p: any) => p.name)).toEqual(expect.arrayContaining(['Status', 'Due']));
      const statusProp = env.data.properties.find((p: any) => p.name === 'Status');
      expect(statusProp.kind).toBe('select');
      expect(statusProp.options.map((o: any) => o.name)).toEqual(expect.arrayContaining(['Unfinished', 'Finished']));
    });
  });
});

describe('cli contract: write powerup --dry-run', () => {
  it('write powerup apply compiles values by propertyName/optionName', async () => {
    await withTmpDb(async (dbPath) => {
      const values = JSON.stringify([{ propertyName: 'Status', value: 'Unfinished' }]);
      const res = await runCli([
        '--json',
        '--remnote-db',
        dbPath,
        'powerup',
        'apply',
        '--rem',
        'R1',
        '--tag-id',
        'T1',
        '--values',
        values,
        '--dry-run',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = JSON.parse(res.stdout.trim());
      expect(env.ok).toBe(true);
      expect(env.data.dry_run).toBe(true);
      expect(env.data.tag_id).toBe('T1');
      expect(env.data.ops[0].type).toBe('add_tag');
      expect(env.data.ops[0].payload.rem_id).toBe('R1');
      expect(env.data.ops[0].payload.tag_id).toBe('T1');
      expect(env.data.ops[1].type).toBe('set_cell_select');
      expect(env.data.ops[1].payload.property_id).toBe('P1');
      expect(env.data.ops[1].payload.option_ids).toBe('O1');
    });
  });

  it('write powerup apply resolves --powerup by title', async () => {
    await withTmpDb(async (dbPath) => {
      const res = await runCli([
        '--json',
        '--remnote-db',
        dbPath,
        'powerup',
        'apply',
        '--rem',
        'R1',
        '--powerup',
        'Todo',
        '--dry-run',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = JSON.parse(res.stdout.trim());
      expect(env.ok).toBe(true);
      expect(env.data.dry_run).toBe(true);
      expect(env.data.tag_id).toBe('T1');
      expect(env.data.powerup.title).toBe('Todo');
      expect(env.data.ops[0].type).toBe('add_tag');
    });
  });

  it('write powerup todo done sets Finished option', async () => {
    await withTmpDb(async (dbPath) => {
      const res = await runCli(['--json', '--remnote-db', dbPath, 'todo', 'done', '--rem', 'R1', '--dry-run']);

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

describe('cli contract: read todos list sort', () => {
  it('accepts --sort updatedAtDesc and createdAtDesc', async () => {
    await withTmpDb(async (dbPath) => {
      const res1 = await runCli([
        '--json',
        '--remnote-db',
        dbPath,
        'todo',
        'list',
        '--sort',
        'updatedAtDesc',
        '--limit',
        '20',
      ]);
      const res2 = await runCli([
        '--json',
        '--remnote-db',
        dbPath,
        'todo',
        'list',
        '--sort',
        'createdAtDesc',
        '--limit',
        '20',
      ]);

      expect(res1.exitCode).toBe(0);
      expect(res1.stderr).toBe('');
      expect(res2.exitCode).toBe(0);
      expect(res2.stderr).toBe('');
    });
  });

  it('status=all returns table rows and parses timestamps', async () => {
    await withTmpDb(async (dbPath) => {
      const res = await runCli([
        '--json',
        '--remnote-db',
        dbPath,
        'todo',
        'list',
        '--status',
        'all',
        '--sort',
        'updatedAtDesc',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = JSON.parse(res.stdout.trim());
      expect(env.ok).toBe(true);
      expect(env.data.limit).toBe(20);

      const row = (env.data.items ?? []).find((it: any) => it.id === 'R1');
      expect(row).toBeTruthy();
      expect(row.source).toBe('table');
      expect(row.updatedAt).toBe(1700000001000);
      expect(row.createdAt).toBe(1700000000000);
    });
  });
});
