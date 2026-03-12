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

    insert.run(typedPropertyId, JSON.stringify({ _id: typedPropertyId, key: ['Status'], ft: 'multi_select' }));
    insert.run(typedOptionId, JSON.stringify({ _id: typedOptionId, key: ['Todo'], parent: typedPropertyId }));
    insert.run(plainPropertyId, JSON.stringify({ _id: plainPropertyId, key: ['Plain'] }));
    insert.run(plainOptionId, JSON.stringify({ _id: plainOptionId, key: ['Loose child'], parent: plainPropertyId }));

    return { typedPropertyId, typedOptionId, plainPropertyId, plainOptionId };
  } finally {
    db.close();
  }
}

describe('cli contract: write powerup option runtime guard', () => {
  it('powerup option add/remove succeed for existing select-like properties', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const dbPath = path.join(tmpDir, 'remnote.db');

    try {
      const { typedPropertyId, typedOptionId } = createOptionGuardDb(dbPath);

      const addRes = await runCli(
        ['--json', 'powerup', 'option', 'add', '--property', typedPropertyId, '--text', 'Todo', '--dry-run'],
        { env: { HOME: tmpHome, REMNOTE_DB: dbPath, REMNOTE_TMUX_REFRESH: '0' } },
      );

      expect(addRes.exitCode).toBe(0);
      expect(addRes.stderr).toBe('');
      const addEnv = parseJsonLine(addRes.stdout);
      expect(addEnv.ok).toBe(true);
      expect(addEnv.data.ops[0].type).toBe('add_option');

      const rmRes = await runCli(
        ['--json', 'powerup', 'option', 'remove', '--option', typedOptionId, '--dry-run'],
        { env: { HOME: tmpHome, REMNOTE_DB: dbPath, REMNOTE_TMUX_REFRESH: '0' } },
      );

      expect(rmRes.exitCode).toBe(0);
      expect(rmRes.stderr).toBe('');
      const rmEnv = parseJsonLine(rmRes.stdout);
      expect(rmEnv.ok).toBe(true);
      expect(rmEnv.data.ops[0].type).toBe('remove_option');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('powerup option add/remove reject plain properties', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const dbPath = path.join(tmpDir, 'remnote.db');

    try {
      const { plainPropertyId, plainOptionId } = createOptionGuardDb(dbPath);

      const addRes = await runCli(
        ['--json', 'powerup', 'option', 'add', '--property', plainPropertyId, '--text', 'Todo', '--dry-run'],
        { env: { HOME: tmpHome, REMNOTE_DB: dbPath, REMNOTE_TMUX_REFRESH: '0' } },
      );

      expect(addRes.exitCode).toBe(2);
      expect(addRes.stderr).toBe('');
      const addEnv = parseJsonLine(addRes.stdout);
      expect(addEnv.ok).toBe(false);
      expect(addEnv.error?.code).toBe('INVALID_ARGS');

      const rmRes = await runCli(
        ['--json', 'powerup', 'option', 'remove', '--option', plainOptionId, '--dry-run'],
        { env: { HOME: tmpHome, REMNOTE_DB: dbPath, REMNOTE_TMUX_REFRESH: '0' } },
      );

      expect(rmRes.exitCode).toBe(2);
      expect(rmRes.stderr).toBe('');
      const rmEnv = parseJsonLine(rmRes.stdout);
      expect(rmEnv.ok).toBe(false);
      expect(rmEnv.error?.code).toBe('INVALID_ARGS');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
