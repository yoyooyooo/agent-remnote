import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';

import { openStoreDb } from '../../src/internal/store/index.js';
import { runCli } from '../helpers/runCli.js';

describe('cli contract: rem outline hides active backup artifacts', () => {
  it('filters backup artifact rems from markdown output when store registry marks them pending', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-outline-backup-'));
    const remnoteDb = path.join(tmpDir, 'remnote.db');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const db = new BetterSqlite3(remnoteDb);
      try {
        db.exec('CREATE TABLE quanta(_id TEXT PRIMARY KEY, doc TEXT NOT NULL);');
        const insert = db.prepare('INSERT INTO quanta(_id, doc) VALUES(?, ?)');
        insert.run('ROOT', JSON.stringify({ key: ['Root'], f: '0' }));
        insert.run('GOOD', JSON.stringify({ key: ['Visible Child'], parent: 'ROOT', f: '1' }));
        insert.run('BACKUP', JSON.stringify({ key: ['agent-remnote: children replace backup (auto)'], parent: 'ROOT', f: '2' }));
      } finally {
        db.close();
      }

      const store = openStoreDb(storeDb);
      try {
        store.prepare(
          `INSERT INTO backup_artifacts(
             source_op_id, source_txn, source_op_type, backup_kind, cleanup_policy, cleanup_state,
             backup_rem_id, source_parent_id, source_anchor_id, result_json, created_at, updated_at, cleaned_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          'op-1',
          'txn-1',
          'replace_children_with_markdown',
          'children_replace',
          'auto',
          'pending',
          'BACKUP',
          'ROOT',
          'ROOT',
          JSON.stringify({ backup_rem_id: 'BACKUP', backup_hidden: true }),
          1,
          1,
          null,
        );
      } finally {
        store.close();
      }

      const res = await runCli(['--json', '--remnote-db', remnoteDb, '--store-db', storeDb, 'rem', 'outline', '--id', 'ROOT'], {
        env: { REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(String(parsed.data?.markdown ?? '')).toContain('Visible Child');
      expect(String(parsed.data?.markdown ?? '')).not.toContain('agent-remnote: children replace backup (auto)');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
