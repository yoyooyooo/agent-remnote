import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';

import { runCli } from '../helpers/runCli.js';

async function withTmpRemnoteDb(fn: (dbPath: string) => Promise<void>): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-remdb-'));
  const dbPath = path.join(tmpDir, 'remnote.db');
  try {
    const db = new BetterSqlite3(dbPath);
    try {
      db.exec(
        'CREATE TABLE remsSearchInfos(id TEXT PRIMARY KEY, aliasId TEXT, doc TEXT, ancestor_not_ref_text TEXT, ancestor_ids TEXT, freqCounter INTEGER, freqTime INTEGER, ftsRowId INTEGER);',
      );
      db.exec('CREATE TABLE remsSearchRanks(ftsRowId INTEGER PRIMARY KEY, rank REAL);');

      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const today = `${yyyy}/${mm}/${dd}`;

      db.prepare(
        'INSERT INTO remsSearchInfos(id, aliasId, doc, ancestor_not_ref_text, ancestor_ids, freqCounter, freqTime, ftsRowId) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        'D1',
        'D1',
        JSON.stringify({ kt: today, ke: today, p: 'DailyDocument', rd: 2 }),
        'Daily Document',
        JSON.stringify(['DailyDocument']),
        0,
        0,
        1,
      );
      db.prepare('INSERT INTO remsSearchRanks(ftsRowId, rank) VALUES(?, ?)').run(1, 0);
    } finally {
      db.close();
    }

    await fn(dbPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe('cli contract: --ids output', () => {
  it('prints ids one per line', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const payload = '[{"type":"create_rem","payload":{"parentId":"dummy-parent","text":"hello"}}]';
      const res = await runCli(['--ids', 'apply', '--no-notify', '--no-ensure-daemon', '--payload', payload], {
        env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb },
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const lines = res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      expect(lines.length).toBe(2);
      expect(lines[0].length).toBeGreaterThan(10);
      expect(lines[1].length).toBeGreaterThan(10);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('prints the resolved daily rem id via daily rem-id --ids', async () => {
    await withTmpRemnoteDb(async (dbPath) => {
      const res = await runCli(['--ids', '--remnote-db', dbPath, 'daily', 'rem-id'], {
        env: { REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      expect(res.stdout.trim()).toBe('D1');
    });
  });
});
