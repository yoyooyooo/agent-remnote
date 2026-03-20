import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';

import { runCli } from '../helpers/runCli.js';

async function withRecentDb(fn: (dbPath: string) => Promise<void>): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-recent-'));
  const dbPath = path.join(tmpDir, 'remnote.db');
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  try {
    const db = new BetterSqlite3(dbPath);
    try {
      db.exec(
        'CREATE TABLE quanta(_id TEXT PRIMARY KEY, doc TEXT NOT NULL);' +
          'CREATE TABLE remsSearchInfos(id TEXT PRIMARY KEY, aliasId TEXT, doc TEXT, ancestor_not_ref_text TEXT, ancestor_ids TEXT, freqCounter INTEGER, freqTime INTEGER, ftsRowId INTEGER);',
      );

      const insertQuanta = db.prepare('INSERT INTO quanta(_id, doc) VALUES(?, ?)');
      const insertInfo = db.prepare(
        'INSERT INTO remsSearchInfos(id, aliasId, doc, ancestor_not_ref_text, ancestor_ids, freqCounter, freqTime, ftsRowId) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
      );

      insertQuanta.run('P1', JSON.stringify({ key: ['Daily Notes'], createdAt: now - 20 * day, m: now - 20 * day }));
      insertQuanta.run('P2', JSON.stringify({ key: ['Projects'], createdAt: now - 20 * day, m: now - 20 * day }));
      insertQuanta.run('C1', JSON.stringify({ key: ['Fresh Idea'], parent: 'P1', createdAt: now - 2 * hour, m: now - hour }));
      insertQuanta.run('M1', JSON.stringify({ key: ['Old Draft'], parent: 'P2', createdAt: now - 15 * day, m: now - 3 * hour }));

      insertInfo.run('P1', 'P1', JSON.stringify({ r: 'Daily Notes', kt: 'Daily Notes', ke: 'Daily Notes' }), '', '', 0, 0, 1);
      insertInfo.run('P2', 'P2', JSON.stringify({ r: 'Projects', kt: 'Projects', ke: 'Projects' }), '', '', 0, 0, 2);
      insertInfo.run('C1', 'C1', JSON.stringify({ r: 'Fresh Idea', kt: 'Fresh Idea', ke: 'Fresh Idea' }), 'Daily Notes', 'P1', 0, 0, 3);
      insertInfo.run('M1', 'M1', JSON.stringify({ r: 'Old Draft', kt: 'Old Draft', ke: 'Old Draft' }), 'Projects', 'P2', 0, 0, 4);
    } finally {
      db.close();
    }

    await fn(dbPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function withNoRecentMatchesDb(fn: (dbPath: string) => Promise<void>): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-recent-empty-'));
  const dbPath = path.join(tmpDir, 'remnote.db');
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  try {
    const db = new BetterSqlite3(dbPath);
    try {
      db.exec(
        'CREATE TABLE quanta(_id TEXT PRIMARY KEY, doc TEXT NOT NULL);' +
          'CREATE TABLE remsSearchInfos(id TEXT PRIMARY KEY, aliasId TEXT, doc TEXT, ancestor_not_ref_text TEXT, ancestor_ids TEXT, freqCounter INTEGER, freqTime INTEGER, ftsRowId INTEGER);',
      );

      db.prepare('INSERT INTO quanta(_id, doc) VALUES(?, ?)').run(
        'OLD',
        JSON.stringify({ key: ['Old Rem'], createdAt: now - 10 * day, m: now - 10 * day }),
      );
      db.prepare(
        'INSERT INTO remsSearchInfos(id, aliasId, doc, ancestor_not_ref_text, ancestor_ids, freqCounter, freqTime, ftsRowId) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('OLD', 'OLD', JSON.stringify({ r: 'Old Rem', kt: 'Old Rem', ke: 'Old Rem' }), '', '', 0, 0, 1);
    } finally {
      db.close();
    }

    await fn(dbPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe('cli contract: read db recent --json', () => {
  it('prints a single json envelope and keeps stderr empty on db error', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const missingDb = path.join(tmpDir, 'missing-remnote.db');

    try {
      const res = await runCli(['--json', '--remnote-db', missingDb, 'db', 'recent']);

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe('DB_UNAVAILABLE');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns normalized items and aggregates through one stable schema', async () => {
    await withRecentDb(async (dbPath) => {
      const res = await runCli([
        '--json',
        '--remnote-db',
        dbPath,
        'db',
        'recent',
        '--days',
        '7',
        '--kind',
        'all',
        '--aggregate',
        'day',
        '--aggregate',
        'parent',
        '--timezone',
        'UTC',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(Array.isArray(parsed.data.items)).toBe(true);
      expect(Array.isArray(parsed.data.aggregates)).toBe(true);
      expect(parsed.data).toHaveProperty('counts');
      expect(parsed.data).not.toHaveProperty('created_items');
      expect(parsed.data).not.toHaveProperty('by_day');

      const kinds = parsed.data.items.map((item: any) => item.activity_kind).sort();
      expect(kinds).toEqual(['created', 'modified_existing']);
      expect(parsed.data.aggregates.some((entry: any) => entry.dimension === 'day')).toBe(true);
      expect(parsed.data.aggregates.some((entry: any) => entry.dimension === 'parent')).toBe(true);
    });
  });

  it('applies generic kind and limit parameters without changing the top-level schema', async () => {
    await withRecentDb(async (dbPath) => {
      const res = await runCli([
        '--json',
        '--remnote-db',
        dbPath,
        'db',
        'recent',
        '--days',
        '7',
        '--kind',
        'created',
        '--aggregate',
        'parent',
        '--item-limit',
        '1',
        '--aggregate-limit',
        '1',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(Array.isArray(parsed.data.items)).toBe(true);
      expect(Array.isArray(parsed.data.aggregates)).toBe(true);
      expect(parsed.data.items).toHaveLength(1);
      expect(parsed.data.aggregates).toHaveLength(1);
      expect(parsed.data.items[0].activity_kind).toBe('created');
      expect(parsed.data).toHaveProperty('counts');
    });
  });

  it('deduplicates repeated aggregate dimensions', async () => {
    await withRecentDb(async (dbPath) => {
      const res = await runCli([
        '--json',
        '--remnote-db',
        dbPath,
        'db',
        'recent',
        '--days',
        '7',
        '--aggregate',
        'day',
        '--aggregate',
        'day',
        '--timezone',
        'Asia/Shanghai',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.aggregate_dimensions).toEqual(['day']);
      expect(parsed.data.aggregates).toHaveLength(1);
      expect(parsed.data.aggregates[0].dimension).toBe('day');
    });
  });

  it('rejects invalid timezone with INVALID_ARGS', async () => {
    await withRecentDb(async (dbPath) => {
      const res = await runCli([
        '--json',
        '--remnote-db',
        dbPath,
        'db',
        'recent',
        '--days',
        '7',
        '--timezone',
        'Invalid/Zone',
      ]);

      expect(res.exitCode).toBe(2);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe('INVALID_ARGS');
      expect(String(parsed.error.message)).toContain('Invalid timezone');
    });
  });

  it('rejects explicitly empty timezone with INVALID_ARGS', async () => {
    await withRecentDb(async (dbPath) => {
      const res = await runCli(['--json', '--remnote-db', dbPath, 'db', 'recent', '--days', '7', '--timezone', ''], {
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(2);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe('INVALID_ARGS');
    });
  });

  it('supports --ids with zero matches', async () => {
    await withNoRecentMatchesDb(async (dbPath) => {
      const res = await runCli(['--ids', '--remnote-db', dbPath, 'db', 'recent', '--days', '1', '--kind', 'modified_existing']);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      expect(res.stdout).toBe('');
    });
  });
});
