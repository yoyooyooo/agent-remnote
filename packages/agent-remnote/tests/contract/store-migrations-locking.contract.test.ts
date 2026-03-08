import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';

import { openStoreDb } from '../../src/internal/store/index.js';

describe('store contract: migrations respect sqlite write locks', () => {
  it('waits for an existing write lock and does not fail fast', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-store-lock-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    let child: ReturnType<typeof spawn> | undefined;
    try {
      const seed = openStoreDb(dbPath);
      seed.close();

      const childExit = new Promise<number>((resolve) => {
        child = spawn(
          process.execPath,
          [
            '-e',
            `
const Database = require('better-sqlite3');
const dbPath = process.env.DB_PATH;
const lockMs = Number(process.env.LOCK_MS || '250');
if (!dbPath) throw new Error('missing DB_PATH');
const db = new Database(dbPath);
db.exec('BEGIN IMMEDIATE');
process.stdout.write('locked\\n');
setTimeout(() => {
  try { db.exec('COMMIT'); } catch {}
  try { db.close(); } catch {}
  process.exit(0);
}, lockMs);
              `.trim(),
          ],
          {
            env: { ...process.env, DB_PATH: dbPath, LOCK_MS: '250' },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        child.once('exit', (code) => resolve(typeof code === 'number' ? code : -1));
      });

      await new Promise<void>((resolve, reject) => {
        if (!child?.stdout) return reject(new Error('child stdout is unavailable'));

        const timer = setTimeout(() => reject(new Error('timeout waiting for child lock')), 2000);
        const onData = (buf: Buffer) => {
          const text = buf.toString('utf8');
          if (!text.includes('locked')) return;
          clearTimeout(timer);
          child?.stdout?.off('data', onData);
          resolve();
        };
        child.stdout.on('data', onData);
      });

      const startedAt = Date.now();
      const db = openStoreDb(dbPath);
      db.close();
      const elapsedMs = Date.now() - startedAt;
      expect(elapsedMs).toBeGreaterThanOrEqual(150);

      const exitCode = await childExit;
      expect(exitCode).toBe(0);
    } finally {
      try {
        child?.kill('SIGKILL');
      } catch {}
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 10_000);
});
