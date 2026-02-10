import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { openStoreDb, StoreSchemaError } from '../../src/internal/store/index.js';

function readUserVersion(db: any): number {
  const raw = db.pragma('user_version', { simple: true }) as any;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : -1;
}

describe('store contract: migration audit', () => {
  it('records contiguous audit rows up to user_version', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-queue-migrations-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openStoreDb(dbPath);
      try {
        const userVersion = readUserVersion(db);
        expect(userVersion).toBeGreaterThan(0);

        const rows = db
          .prepare(`SELECT version, name, checksum, applied_at, app_version FROM store_migrations ORDER BY version ASC`)
          .all() as any[];

        expect(rows.length).toBe(userVersion);

        for (let i = 0; i < rows.length; i += 1) {
          expect(Number(rows[i]?.version)).toBe(i + 1);
          expect(typeof rows[i]?.name).toBe('string');
          expect(String(rows[i]?.checksum)).toMatch(/^[0-9a-f]{64}$/);
          expect(Number(rows[i]?.applied_at)).toBeGreaterThan(0);
          expect(typeof rows[i]?.app_version).toBe('string');
          expect(String(rows[i]?.app_version).length).toBeGreaterThan(0);
        }
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails fast on checksum drift', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-queue-migrations-drift-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openStoreDb(dbPath);
      try {
        db.prepare(`UPDATE store_migrations SET checksum='deadbeef' WHERE version=2`).run();
      } finally {
        db.close();
      }

      expect(() => openStoreDb(dbPath)).toThrow(StoreSchemaError);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
