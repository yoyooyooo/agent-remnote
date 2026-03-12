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
    insert.run('p_select', JSON.stringify({ _id: 'p_select', key: ['Status'], ft: 'single_select' }));
    insert.run('o_select', JSON.stringify({ _id: 'o_select', key: ['Todo'], parent: 'p_select' }));
    insert.run('p_plain', JSON.stringify({ _id: 'p_plain', key: ['Plain'] }));
    insert.run('o_plain', JSON.stringify({ _id: 'o_plain', key: ['Loose child'], parent: 'p_plain' }));
  } finally {
    db.close();
  }
}

describe('cli contract: apply property-type runtime guard', () => {
  it('rejects typed add_property ops with a stable error.code in --json mode', async () => {
    const payload =
      '{"version":1,"kind":"ops","ops":[{"type":"add_property","payload":{"tagId":"tag1","name":"Status","type":"single_select","options":["Todo","Done"]}}]}';
    const res = await runCli(['--json', 'apply', '--payload', payload]);

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('WRITE_UNAVAILABLE');
    expect(env.error?.message).toContain('Typed property creation');
  });

  it('rejects set_property_type ops with a stable error.code in --json mode', async () => {
    const payload =
      '{"version":1,"kind":"ops","ops":[{"type":"set_property_type","payload":{"propertyId":"prop1","type":"text"}}]}';
    const res = await runCli(['--json', 'apply', '--payload', payload]);

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('WRITE_UNAVAILABLE');
    expect(env.error?.message).toContain('Property type mutation');
  });

  it('rejects add_option/remove_option ops when the local DB target is not select-like', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const dbPath = path.join(tmpDir, 'remnote.db');

    try {
      createOptionGuardDb(dbPath);

      const addPayload =
        '{"version":1,"kind":"ops","ops":[{"type":"add_option","payload":{"propertyId":"p_plain","text":"Todo"}}]}';
      const addRes = await runCli(['--json', 'apply', '--payload', addPayload], {
        env: { HOME: tmpHome, REMNOTE_DB: dbPath, REMNOTE_TMUX_REFRESH: '0' },
      });

      expect(addRes.exitCode).toBe(2);
      expect(addRes.stderr).toBe('');
      const addEnv = parseJsonLine(addRes.stdout);
      expect(addEnv.ok).toBe(false);
      expect(addEnv.error?.code).toBe('INVALID_ARGS');

      const removePayload =
        '{"version":1,"kind":"ops","ops":[{"type":"remove_option","payload":{"optionId":"o_plain"}}]}';
      const removeRes = await runCli(['--json', 'apply', '--payload', removePayload], {
        env: { HOME: tmpHome, REMNOTE_DB: dbPath, REMNOTE_TMUX_REFRESH: '0' },
      });

      expect(removeRes.exitCode).toBe(2);
      expect(removeRes.stderr).toBe('');
      const removeEnv = parseJsonLine(removeRes.stdout);
      expect(removeEnv.ok).toBe(false);
      expect(removeEnv.error?.code).toBe('INVALID_ARGS');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
