import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { openStoreDb } from '../../src/internal/store/index.js';
import { runCli } from '../helpers/runCli.js';

describe('cli contract: backup commands', () => {
  it('lists non-cleaned backup artifacts from the store registry', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-backup-'));
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openStoreDb(storeDb);
      try {
        db.prepare(
          `INSERT INTO backup_artifacts(
             source_op_id, source_txn, source_op_type, backup_kind, cleanup_policy, cleanup_state,
             backup_rem_id, source_parent_id, source_anchor_id, result_json, created_at, updated_at, cleaned_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          'op-1',
          'txn-1',
          'replace_children_with_markdown',
          'children_replace',
          'visible',
          'retained',
          'backup-rem-1',
          'parent-1',
          'anchor-1',
          JSON.stringify({ backup_rem_id: 'backup-rem-1' }),
          1,
          1,
          null,
        );
        db.prepare(
          `INSERT INTO backup_artifacts(
             source_op_id, source_txn, source_op_type, backup_kind, cleanup_policy, cleanup_state,
             backup_rem_id, source_parent_id, source_anchor_id, result_json, created_at, updated_at, cleaned_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          'op-2',
          'txn-2',
          'replace_selection_with_markdown',
          'selection_replace',
          'auto',
          'cleaned',
          null,
          'parent-2',
          'anchor-2',
          JSON.stringify({ backup_deleted: true }),
          2,
          2,
          2,
        );
      } finally {
        db.close();
      }

      const res = await runCli(['--json', '--store-db', storeDb, 'backup', 'list'], {
        env: { REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.items).toHaveLength(1);
      expect(parsed.data.items[0]).toMatchObject({
        source_op_id: 'op-1',
        cleanup_state: 'retained',
        backup_rem_id: 'backup-rem-1',
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('cleanup defaults to dry-run and does not mutate registry state', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-backup-'));
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openStoreDb(storeDb);
      try {
        db.prepare(
          `INSERT INTO backup_artifacts(
             source_op_id, source_txn, source_op_type, backup_kind, cleanup_policy, cleanup_state,
             backup_rem_id, source_parent_id, source_anchor_id, result_json, created_at, updated_at, cleaned_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          'op-orphan',
          'txn-orphan',
          'replace_children_with_markdown',
          'children_replace',
          'auto',
          'orphan',
          'backup-rem-orphan',
          'parent-1',
          'anchor-1',
          JSON.stringify({ backup_rem_id: 'backup-rem-orphan' }),
          1,
          1,
          null,
        );
      } finally {
        db.close();
      }

      const res = await runCli(['--json', '--store-db', storeDb, 'backup', 'cleanup'], {
        env: { REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.dry_run).toBe(true);
      expect(parsed.data.items).toHaveLength(1);

      const db2 = openStoreDb(storeDb);
      try {
        const row = db2.prepare(`SELECT cleanup_state FROM backup_artifacts WHERE source_op_id=?`).get('op-orphan') as any;
        expect(row.cleanup_state).toBe('orphan');
      } finally {
        db2.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('cleanup --backup-rem-id dry-runs the exact retained backup instead of the newest one', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-backup-'));
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openStoreDb(storeDb);
      try {
        const insert = db.prepare(
          `INSERT INTO backup_artifacts(
             source_op_id, source_txn, source_op_type, backup_kind, cleanup_policy, cleanup_state,
             backup_rem_id, source_parent_id, source_anchor_id, result_json, created_at, updated_at, cleaned_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        insert.run(
          'op-old',
          'txn-old',
          'replace_children_with_markdown',
          'children_replace',
          'visible',
          'retained',
          'backup-rem-old',
          'parent-1',
          'anchor-1',
          JSON.stringify({ backup_rem_id: 'backup-rem-old' }),
          1,
          1,
          null,
        );
        insert.run(
          'op-new',
          'txn-new',
          'replace_children_with_markdown',
          'children_replace',
          'visible',
          'retained',
          'backup-rem-new',
          'parent-1',
          'anchor-1',
          JSON.stringify({ backup_rem_id: 'backup-rem-new' }),
          2,
          2,
          null,
        );
      } finally {
        db.close();
      }

      const res = await runCli(['--json', '--store-db', storeDb, 'backup', 'cleanup', '--backup-rem-id', 'backup-rem-old'], {
        env: { REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.dry_run).toBe(true);
      expect(parsed.data.items).toHaveLength(1);
      expect(parsed.data.items[0].backup_rem_id).toBe('backup-rem-old');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('cleanup --backup-rem-id --apply enqueues delete_backup_artifact for the exact backup and marks only that row pending', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-backup-'));
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openStoreDb(storeDb);
      try {
        const insert = db.prepare(
          `INSERT INTO backup_artifacts(
             source_op_id, source_txn, source_op_type, backup_kind, cleanup_policy, cleanup_state,
             backup_rem_id, source_parent_id, source_anchor_id, result_json, created_at, updated_at, cleaned_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        insert.run(
          'op-old',
          'txn-old',
          'replace_children_with_markdown',
          'children_replace',
          'visible',
          'retained',
          'backup-rem-old',
          'parent-1',
          'anchor-1',
          JSON.stringify({ backup_rem_id: 'backup-rem-old' }),
          1,
          1,
          null,
        );
        insert.run(
          'op-new',
          'txn-new',
          'replace_children_with_markdown',
          'children_replace',
          'visible',
          'retained',
          'backup-rem-new',
          'parent-1',
          'anchor-1',
          JSON.stringify({ backup_rem_id: 'backup-rem-new' }),
          2,
          2,
          null,
        );
      } finally {
        db.close();
      }

      const res = await runCli(
        [
          '--json',
          '--store-db',
          storeDb,
          'backup',
          'cleanup',
          '--backup-rem-id',
          'backup-rem-old',
          '--apply',
          '--no-notify',
          '--no-ensure-daemon',
        ],
        {
          env: { REMNOTE_TMUX_REFRESH: '0' },
          timeoutMs: 15_000,
        },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.dry_run).toBe(false);
      expect(parsed.data.items).toHaveLength(1);
      expect(parsed.data.items[0].backup_rem_id).toBe('backup-rem-old');

      const db2 = openStoreDb(storeDb);
      try {
        const pending = db2
          .prepare(`SELECT source_op_id, cleanup_state FROM backup_artifacts WHERE source_op_id IN ('op-old','op-new') ORDER BY source_op_id ASC`)
          .all() as any[];
        expect(pending).toEqual([
          { source_op_id: 'op-new', cleanup_state: 'retained' },
          { source_op_id: 'op-old', cleanup_state: 'pending' },
        ]);

        const queued = db2.prepare(`SELECT payload_json FROM queue_ops`).all() as any[];
        expect(queued).toHaveLength(1);
        expect(JSON.parse(String(queued[0].payload_json)).rem_id).toBe('backup-rem-old');
        const opTypes = db2.prepare(`SELECT type FROM queue_ops`).all() as any[];
        expect(opTypes).toEqual([{ type: 'delete_backup_artifact' }]);
      } finally {
        db2.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('cleanup --backup-rem-id --max-delete-subtree-nodes --apply passes dynamic subtree threshold into queue payload', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-backup-'));
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openStoreDb(storeDb);
      try {
        db.prepare(
          `INSERT INTO backup_artifacts(
             source_op_id, source_txn, source_op_type, backup_kind, cleanup_policy, cleanup_state,
             backup_rem_id, source_parent_id, source_anchor_id, result_json, created_at, updated_at, cleaned_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          'op-dynamic',
          'txn-dynamic',
          'replace_children_with_markdown',
          'children_replace',
          'auto',
          'pending',
          'backup-rem-dynamic',
          'parent-1',
          'anchor-1',
          JSON.stringify({ backup_rem_id: 'backup-rem-dynamic' }),
          1,
          1,
          null,
        );
      } finally {
        db.close();
      }

      const res = await runCli(
        [
          '--json',
          '--store-db',
          storeDb,
          'backup',
          'cleanup',
          '--backup-rem-id',
          'backup-rem-dynamic',
          '--max-delete-subtree-nodes',
          '77',
          '--apply',
          '--no-notify',
          '--no-ensure-daemon',
        ],
        {
          env: { REMNOTE_TMUX_REFRESH: '0' },
          timeoutMs: 15_000,
        },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);

      const db2 = openStoreDb(storeDb);
      try {
        const queued = db2.prepare(`SELECT payload_json FROM queue_ops`).all() as any[];
        expect(queued).toHaveLength(1);
        const payload = JSON.parse(String(queued[0].payload_json));
        expect(payload.rem_id).toBe('backup-rem-dynamic');
        expect(payload.max_delete_subtree_nodes).toBe(77);
      } finally {
        db2.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
