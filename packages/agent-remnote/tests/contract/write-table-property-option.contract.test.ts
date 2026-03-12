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

function createOptionGuardDb(dbPath: string) {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS quanta (
        _id TEXT PRIMARY KEY,
        doc TEXT NOT NULL
      );
    `);

    const insert = db.prepare('INSERT INTO quanta (_id, doc) VALUES (?, ?)');

    const typedPropertyId = 'p_select';
    const typedOptionId = 'o_select';
    const plainPropertyId = 'p_plain';
    const plainOptionId = 'o_plain';

    insert.run(
      typedPropertyId,
      JSON.stringify({
        _id: typedPropertyId,
        key: ['Status'],
        ft: 'single_select',
        parent: 'tag1',
      }),
    );
    insert.run(
      typedOptionId,
      JSON.stringify({
        _id: typedOptionId,
        key: ['Todo'],
        parent: typedPropertyId,
      }),
    );
    insert.run(
      plainPropertyId,
      JSON.stringify({
        _id: plainPropertyId,
        key: ['Plain'],
        parent: 'tag1',
      }),
    );
    insert.run(
      plainOptionId,
      JSON.stringify({
        _id: plainOptionId,
        key: ['Loose child'],
        parent: plainPropertyId,
      }),
    );

    return { typedPropertyId, typedOptionId, plainPropertyId, plainOptionId };
  } finally {
    db.close();
  }
}

describe('cli contract: write table property/option', () => {
  it('write table property add --dry-run --json emits add_property op for plain properties', async () => {
    const res = await runCli([
      '--json',
      'table',
      'property',
      'add',
      '--table-tag',
      't1',
      '--name',
      'Status',
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
    expect(env.data.ops[0].payload.type).toBeUndefined();
    expect(env.data.ops[0].payload.options).toBeUndefined();
  });

  it('write table property add rejects typed property creation with a stable error.code in --json mode', async () => {
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

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('WRITE_UNAVAILABLE');
    expect(env.error?.message).toContain('Typed property creation');
  });

  it('write table property set-type rejects with a stable error.code in --json mode', async () => {
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

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('WRITE_UNAVAILABLE');
    expect(env.error?.message).toContain('Property type mutation');
  });

  it('write table option add/remove --dry-run --json emits ops when property is already select-like in DB', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const dbPath = path.join(tmpDir, 'remnote.db');

    try {
      const { typedPropertyId, typedOptionId } = createOptionGuardDb(dbPath);

      const addRes = await runCli(
        ['--json', 'table', 'option', 'add', '--property', typedPropertyId, '--text', 'Todo', '--dry-run'],
        { env: { HOME: tmpHome, REMNOTE_DB: dbPath, REMNOTE_TMUX_REFRESH: '0' } },
      );

      expect(addRes.exitCode).toBe(0);
      expect(addRes.stderr).toBe('');

      const addEnv = parseJsonLine(addRes.stdout);
      expect(addEnv.ok).toBe(true);
      expect(addEnv.data?.dry_run).toBe(true);
      expect(addEnv.data.ops[0].type).toBe('add_option');
      expect(addEnv.data.ops[0].payload.property_id).toBe(typedPropertyId);
      expect(addEnv.data.ops[0].payload.text).toBe('Todo');

      const rmRes = await runCli(
        ['--json', 'table', 'option', 'remove', '--option', typedOptionId, '--dry-run'],
        { env: { HOME: tmpHome, REMNOTE_DB: dbPath, REMNOTE_TMUX_REFRESH: '0' } },
      );
      expect(rmRes.exitCode).toBe(0);
      expect(rmRes.stderr).toBe('');

      const rmEnv = parseJsonLine(rmRes.stdout);
      expect(rmEnv.ok).toBe(true);
      expect(rmEnv.data?.dry_run).toBe(true);
      expect(rmEnv.data.ops[0].type).toBe('remove_option');
      expect(rmEnv.data.ops[0].payload.option_id).toBe(typedOptionId);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('write table option add/remove reject plain properties with a stable error.code in --json mode', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const dbPath = path.join(tmpDir, 'remnote.db');

    try {
      const { plainPropertyId, plainOptionId } = createOptionGuardDb(dbPath);

      const addRes = await runCli(
        ['--json', 'table', 'option', 'add', '--property', plainPropertyId, '--text', 'Todo', '--dry-run'],
        { env: { HOME: tmpHome, REMNOTE_DB: dbPath, REMNOTE_TMUX_REFRESH: '0' } },
      );
      expect(addRes.exitCode).toBe(2);
      expect(addRes.stderr).toBe('');

      const addEnv = parseJsonLine(addRes.stdout);
      expect(addEnv.ok).toBe(false);
      expect(addEnv.error?.code).toBe('INVALID_ARGS');
      expect(addEnv.error?.message).toContain('Option mutation requires property');

      const rmRes = await runCli(
        ['--json', 'table', 'option', 'remove', '--option', plainOptionId, '--dry-run'],
        { env: { HOME: tmpHome, REMNOTE_DB: dbPath, REMNOTE_TMUX_REFRESH: '0' } },
      );
      expect(rmRes.exitCode).toBe(2);
      expect(rmRes.stderr).toBe('');

      const rmEnv = parseJsonLine(rmRes.stdout);
      expect(rmEnv.ok).toBe(false);
      expect(rmEnv.error?.code).toBe('INVALID_ARGS');
      expect(rmEnv.error?.message).toContain('Option mutation requires option');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
