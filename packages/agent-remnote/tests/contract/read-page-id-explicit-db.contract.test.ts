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

function createMinimalPageDb(dbPath: string) {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE quanta (
        _id TEXT PRIMARY KEY,
        doc TEXT NOT NULL
      );
    `);

    const insert = db.prepare('INSERT INTO quanta (_id, doc) VALUES (?, ?)');
    insert.run('page1', JSON.stringify({ _id: 'page1', key: ['Page'], parent: null }));
    insert.run('child1', JSON.stringify({ _id: 'child1', key: ['Child'], parent: 'page1' }));
  } finally {
    db.close();
  }
}

function createNestedPageDb(dbPath: string) {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE quanta (
        _id TEXT PRIMARY KEY,
        doc TEXT NOT NULL
      );
    `);

    const insert = db.prepare('INSERT INTO quanta (_id, doc) VALUES (?, ?)');
    insert.run('page-top', JSON.stringify({ _id: 'page-top', key: ['Top Page'], parent: null }));
    insert.run('page-current', JSON.stringify({ _id: 'page-current', key: ['Current Page'], parent: 'page-top' }));
    insert.run('child-1', JSON.stringify({ _id: 'child-1', key: ['Child'], parent: 'page-current' }));
  } finally {
    db.close();
  }
}

describe('cli contract: read page-id explicit db', () => {
  it('resolves via REMNOTE_DB without requiring a workspace binding', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-page-id-'));
    const tmpHome = path.join(tmpDir, 'home');
    const dbPath = path.join(tmpDir, 'remnote.db');

    try {
      createMinimalPageDb(dbPath);

      const res = await runCli(['--json', 'rem', 'page-id', '--id', 'child1'], {
        env: { HOME: tmpHome, REMNOTE_DB: dbPath, REMNOTE_TMUX_REFRESH: '0' },
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);
      expect(env.data.results[0].pageId).toBe('page1');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('keeps climbing to the top-level owning page instead of stopping at the first page-like ancestor', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-page-id-nested-'));
    const tmpHome = path.join(tmpDir, 'home');
    const dbPath = path.join(tmpDir, 'remnote.db');

    try {
      createNestedPageDb(dbPath);

      const res = await runCli(['--json', 'rem', 'page-id', '--id', 'child-1', '--detail'], {
        env: { HOME: tmpHome, REMNOTE_DB: dbPath, REMNOTE_TMUX_REFRESH: '0' },
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);
      expect(env.data.results[0]).toMatchObject({
        id: 'child-1',
        found: true,
        pageId: 'page-top',
        hops: 2,
        truncated: false,
        cycle_detected: false,
        chain: ['child-1', 'page-current', 'page-top'],
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
