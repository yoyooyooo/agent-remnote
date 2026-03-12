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

function createCurrentTableShapeDb(dbPath: string) {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS quanta (
        _id TEXT PRIMARY KEY,
        doc TEXT NOT NULL
      );
    `);

    const insert = db.prepare('INSERT INTO quanta (_id, doc) VALUES (?, ?)');

    const tagId = 'tag_current';
    const slotTagId = '3wEt8kouRanAWhtRf';
    const propertyId = 'prop_status';
    const optionTodoId = 'opt_todo';
    const optionDoneId = 'opt_done';
    const rowId = 'row_1';
    const cellId = 'cell_1';

    insert.run(slotTagId, JSON.stringify({ _id: slotTagId, key: ['Template Slot'], rcrt: 'y' }));
    insert.run(tagId, JSON.stringify({ _id: tagId, key: ['Current Table Tag'], type: 1 }));
    insert.run(
      propertyId,
      JSON.stringify({
        _id: propertyId,
        parent: tagId,
        key: [{ i: 'm', text: 'Status' }],
        tp: { [slotTagId]: { t: true } },
        crt: { y: {} },
        f: 'a0',
        type: 1,
      }),
    );
    insert.run(
      optionTodoId,
      JSON.stringify({
        _id: optionTodoId,
        parent: propertyId,
        key: [{ i: 'm', text: 'Todo' }],
        f: 'a0',
        type: 1,
      }),
    );
    insert.run(
      optionDoneId,
      JSON.stringify({
        _id: optionDoneId,
        parent: propertyId,
        key: [{ i: 'm', text: 'Done' }],
        f: 'a1',
        type: 1,
      }),
    );
    insert.run(
      rowId,
      JSON.stringify({
        _id: rowId,
        key: [{ i: 'm', text: 'First Row' }],
        tp: { [tagId]: { t: true } },
        type: 1,
      }),
    );
    insert.run(
      cellId,
      JSON.stringify({
        _id: cellId,
        parent: rowId,
        key: [{ i: 'q', _id: propertyId }],
        value: [{ i: 'q', _id: optionTodoId }],
      }),
    );

    return { tagId, propertyId, optionTodoId, optionDoneId, rowId };
  } finally {
    db.close();
  }
}

describe('cli contract: table show current property shape', () => {
  it('lists properties and options when properties are marked via tp slot tag instead of rcrs', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-table-show-current-shape-'));
    const dbPath = path.join(tmpDir, 'remnote.db');

    try {
      const { tagId, propertyId, optionTodoId, optionDoneId, rowId } = createCurrentTableShapeDb(dbPath);

      const res = await runCli(['--json', 'table', 'show', '--id', tagId, '--include-options'], {
        env: { REMNOTE_DB: dbPath },
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);
      expect(env.data.propertyCount).toBe(1);
      expect(env.data.properties[0].id).toBe(propertyId);
      expect(env.data.properties[0].name).toBe('Status');
      expect(env.data.properties[0].kind).toBe('select');
      expect(env.data.properties[0].options.map((item: any) => item.id)).toEqual([optionTodoId, optionDoneId]);
      expect(env.data.properties[0].options.map((item: any) => item.name)).toEqual(['Todo', 'Done']);
      expect(env.data.rowCount).toBe(1);
      expect(env.data.rows[0].id).toBe(rowId);
      expect(env.data.rows[0].cells[propertyId].optionIds).toEqual([optionTodoId]);
      expect(env.data.rows[0].cells[propertyId].optionNames).toEqual(['Todo']);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
