import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';

import { runCli } from '../helpers/runCli.js';

async function withOutlineDb(fn: (dbPath: string) => Promise<void>): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-outline-'));
  const dbPath = path.join(tmpDir, 'remnote.db');

  try {
    const db = new BetterSqlite3(dbPath);
    try {
      db.exec('CREATE TABLE quanta(_id TEXT PRIMARY KEY, doc TEXT NOT NULL);');
      const insert = db.prepare('INSERT INTO quanta(_id, doc) VALUES(?, ?)');

      insert.run('ROOT', JSON.stringify({ key: ['Root'], f: '0' }));
      insert.run('TARGET', JSON.stringify({ key: ['Target Title'], f: '0' }));
      insert.run('PORTAL_OK', JSON.stringify({ key: [{ i: 'p', _id: 'TARGET' }], parent: 'ROOT', f: '1' }));
      insert.run('PORTAL_MISSING', JSON.stringify({ key: [{ i: 'p', _id: 'MISSING' }], parent: 'ROOT', f: '2' }));
      insert.run(
        'PORTAL_REAL',
        JSON.stringify({ key: [], type: 6, pd: { TARGET: { d: true } }, parent: 'ROOT', f: '3' }),
      );
      insert.run('INLINE_REF', JSON.stringify({ key: ['See ', { i: 'q', _id: 'TARGET' }], parent: 'ROOT', f: '4' }));
      insert.run('PLAIN', JSON.stringify({ key: ['Plain Child'], parent: 'ROOT', f: '5' }));
    } finally {
      db.close();
    }

    await fn(dbPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe('cli contract: rem outline typed portal nodes', () => {
  it('returns typed nodes with target metadata in json mode', async () => {
    await withOutlineDb(async (dbPath) => {
      const res = await runCli(['--json', '--remnote-db', dbPath, 'rem', 'outline', '--id', 'ROOT', '--format', 'json'], {
        env: { REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(Array.isArray(parsed.data?.tree)).toBe(true);

      const nodes = parsed.data.tree as any[];
      const portalOk = nodes.find((node) => node.id === 'PORTAL_OK');
      const portalMissing = nodes.find((node) => node.id === 'PORTAL_MISSING');
      const portalReal = nodes.find((node) => node.id === 'PORTAL_REAL');
      const inlineRef = nodes.find((node) => node.id === 'INLINE_REF');
      const plain = nodes.find((node) => node.id === 'PLAIN');

      expect(portalOk?.kind).toBe('portal');
      expect(portalOk?.target).toEqual({ id: 'TARGET', text: 'Target Title', resolved: true });

      expect(portalMissing?.kind).toBe('portal');
      expect(portalMissing?.target).toEqual({ id: 'MISSING', text: null, resolved: false });

      expect(portalReal?.kind).toBe('portal');
      expect(portalReal?.target).toEqual({ id: 'TARGET', text: 'Target Title', resolved: true });

      expect(inlineRef?.kind).toBe('rem');
      expect(inlineRef?.target ?? null).toBe(null);

      expect(plain?.kind).toBe('rem');
      expect(plain?.target ?? null).toBe(null);
    });
  });
});
