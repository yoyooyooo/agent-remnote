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

describe('cli contract: runtime owner doctor visibility', () => {
  it('reports canonical fixed-owner claim and ownership check ids', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-doctor-'));
    const tmpHome = path.join(tmpDir, 'home');
    const remnoteDb = path.join(tmpDir, 'remnote.db');

    try {
      createMinimalRemnoteDb(remnoteDb);

      const res = await runCli(['--json', '--remnote-db', remnoteDb, 'doctor'], {
        env: { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.fixed_owner_claim).toMatchObject({
        claimed_channel: 'stable',
        control_plane_root: path.join(tmpHome, '.agent-remnote'),
        port_class: 'canonical',
      });
      expect(Array.isArray(parsed.data.checks)).toBe(true);
      expect((parsed.data.checks as any[]).some((item) => item.id === 'runtime.fixed_owner_claim_present')).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
