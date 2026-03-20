import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import Database from 'better-sqlite3';

import { runCli } from '../helpers/runCli.js';

function createMinimalRemnoteDb(dbPath: string) {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE quanta (
        _id TEXT PRIMARY KEY,
        doc TEXT NOT NULL
      );
    `);
    db.prepare('INSERT INTO quanta (_id, doc) VALUES (?, ?)').run('page1', JSON.stringify({ _id: 'page1', key: ['Page'] }));
  } finally {
    db.close();
  }
}

describe('cli contract: doctor schema visibility', () => {
  it('reports store schema version and migration counts in json mode', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-doctor-schema-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');
    const remnoteDb = path.join(tmpDir, 'remnote.db');

    try {
      createMinimalRemnoteDb(remnoteDb);

      const res = await runCli(['--json', '--store-db', storeDb, '--remnote-db', remnoteDb, 'doctor'], {
        env: { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 20_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(typeof parsed.data?.queue?.schema?.current_user_version).toBe('number');
      expect(typeof parsed.data?.queue?.schema?.latest_supported_version).toBe('number');
      expect(typeof parsed.data?.queue?.schema?.applied_migrations).toBe('number');
      expect(parsed.data.queue.schema.latest_supported_version).toBeGreaterThan(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
