import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: read powerup list --json', () => {
  it('prints a single json envelope and keeps stderr empty on db error', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const missingDb = path.join(tmpDir, 'missing-remnote.db');

    try {
      const res = await runCli(['--json', '--remnote-db', missingDb, 'powerup', 'list']);

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe('DB_UNAVAILABLE');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('lists powerups from a minimal quanta database', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const dbPath = path.join(tmpDir, 'remnote.db');

    try {
      const db = new BetterSqlite3(dbPath);
      try {
        db.exec('CREATE TABLE quanta(_id TEXT PRIMARY KEY, doc TEXT NOT NULL);');
        const insert = db.prepare('INSERT INTO quanta(_id, doc) VALUES(?, ?)');
        insert.run('P1', JSON.stringify({ key: ['Todo'], rcrt: 't', createdAt: 1000 }));
        insert.run('P2', JSON.stringify({ key: ['Mermaid'], rcrt: 'memaid_powerup', createdAt: 2000 }));
        insert.run('C1', JSON.stringify({ key: ['Child'], rcrt: 'x', parent: 'P1', createdAt: 3000 }));
      } finally {
        db.close();
      }

      const res = await runCli(['--json', '--remnote-db', dbPath, 'powerup', 'list', '--limit', '10']);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.total).toBe(2);
      expect(parsed.data.items.map((it: any) => it.id)).toEqual(['P1', 'P2']);
      expect(parsed.data.items.map((it: any) => it.rcrt)).toEqual(['t', 'memaid_powerup']);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
