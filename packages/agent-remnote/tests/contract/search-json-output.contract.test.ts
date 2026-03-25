import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import {
  installPackedCli,
  packAgentRemnoteCli,
  runInstalledCli,
} from '../helpers/packedCli.js';

function createSearchableRemnoteDb(dbPath: string) {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE quanta (
        _id TEXT PRIMARY KEY,
        doc TEXT NOT NULL
      );

      CREATE TABLE remsSearchInfos (
        aliasId TEXT,
        id TEXT PRIMARY KEY,
        doc TEXT NOT NULL,
        ftsRowId INTEGER,
        freqCounter INTEGER DEFAULT 0,
        freqTime INTEGER DEFAULT 0,
        ancestor_not_ref_text TEXT,
        ancestor_ids TEXT
      );

      CREATE TABLE remsSearchRanks (
        ftsRowId INTEGER PRIMARY KEY,
        rank REAL DEFAULT 0
      );
    `);

    const doc = JSON.stringify({
      kt: 'ITEST Search JSON Output',
      ke: 'ITEST Search JSON Output',
      r: 'itest search json output',
      p: null,
      rd: 1,
      c: Date.now(),
    });

    db.prepare('INSERT INTO quanta (_id, doc) VALUES (?, ?)').run('page1', JSON.stringify({ _id: 'page1' }));
    db.prepare(
      `INSERT INTO remsSearchInfos (aliasId, id, doc, ftsRowId, freqCounter, freqTime, ancestor_not_ref_text, ancestor_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('page1', 'page1', doc, 1, 1, Date.now(), 'Daily Document / Test', JSON.stringify([]));
    db.prepare('INSERT INTO remsSearchRanks (ftsRowId, rank) VALUES (?, ?)').run(1, 1);
  } finally {
    db.close();
  }
}

function createSlowSearchableRemnoteDb(dbPath: string) {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE quanta (
        _id TEXT PRIMARY KEY,
        doc TEXT NOT NULL
      );

      CREATE TABLE remsSearchInfos (
        aliasId TEXT,
        id TEXT PRIMARY KEY,
        doc TEXT NOT NULL,
        ftsRowId INTEGER,
        freqCounter INTEGER DEFAULT 0,
        freqTime INTEGER DEFAULT 0,
        ancestor_not_ref_text TEXT,
        ancestor_ids TEXT
      );

      CREATE VIEW remsSearchRanks AS
      WITH RECURSIVE cnt(x) AS (
        SELECT 1
        UNION ALL
        SELECT x + 1 FROM cnt WHERE x < 500000
      )
      SELECT 1 AS ftsRowId, sum(x) AS rank FROM cnt;
    `);

    const doc = JSON.stringify({
      kt: 'ITEST Slow Search Timeout',
      ke: 'ITEST Slow Search Timeout',
      r: 'itest slow search timeout',
      p: null,
      rd: 1,
      c: Date.now(),
    });

    db.prepare('INSERT INTO quanta (_id, doc) VALUES (?, ?)').run('page1', JSON.stringify({ _id: 'page1' }));
    db.prepare(
      `INSERT INTO remsSearchInfos (aliasId, id, doc, ftsRowId, freqCounter, freqTime, ancestor_not_ref_text, ancestor_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('page1', 'page1', doc, 1, 1, Date.now(), 'Daily Document / Timeout', JSON.stringify([]));
  } finally {
    db.close();
  }
}

describe('cli contract: installed search --json stdout purity', () => {
  let packDir = '';
  let tarballPath = '';
  let installDir = '';
  let cliPath = '';
  let dbDir = '';
  let remnoteDb = '';
  let slowRemnoteDb = '';

  beforeAll(async () => {
    const packed = await packAgentRemnoteCli();
    packDir = packed.workDir;
    tarballPath = packed.tarballPath;

    const installed = await installPackedCli(tarballPath);
    installDir = installed.installDir;
    cliPath = installed.cliPath;

    dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-search-json-'));
    remnoteDb = path.join(dbDir, 'remnote.db');
    slowRemnoteDb = path.join(dbDir, 'remnote-slow.db');
    createSearchableRemnoteDb(remnoteDb);
    createSlowSearchableRemnoteDb(slowRemnoteDb);
  }, 240_000);

  afterAll(async () => {
    await fs.rm(dbDir, { recursive: true, force: true });
    await fs.rm(installDir, { recursive: true, force: true });
    await fs.rm(packDir, { recursive: true, force: true });
  });

  it('prints exactly one JSON envelope to stdout on success', async () => {
    const res = await runInstalledCli({
      cliPath,
      args: ['--json', '--remnote-db', remnoteDb, 'search', '--query', 'ITEST Search JSON Output', '--limit', '5'],
      timeoutMs: 30_000,
    });

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const trimmed = res.stdout.trim();
    expect(trimmed.startsWith('{')).toBe(true);
    expect(() => JSON.parse(trimmed)).not.toThrow();

    const parsed = JSON.parse(trimmed);
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.count).toBe(1);
  });

  it('keeps timeout behavior in installed package mode', async () => {
    const res = await runInstalledCli({
      cliPath,
      args: ['--json', '--remnote-db', slowRemnoteDb, 'search', '--query', 'ITEST Slow Search Timeout', '--limit', '5', '--timeout-ms', '10'],
      timeoutMs: 30_000,
    });

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe('TIMEOUT');
    expect(String(parsed.error?.message ?? '')).toContain('timed out');
  });
});
