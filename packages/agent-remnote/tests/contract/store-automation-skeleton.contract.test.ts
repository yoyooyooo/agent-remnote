import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { openStoreDb } from '../../src/internal/store/index.js';
import {
  getTaskRunById,
  insertEventRecord,
  upsertTaskDefinition,
  upsertTaskRun,
  upsertTriggerRule,
} from '../../src/internal/store/automationDao.js';

describe('contract: store automation skeleton', () => {
  it('creates automation tables and preserves dedupe plus queue linkage facts', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-store-automation-'));
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openStoreDb(storeDb);
      try {
        const tableNames = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as Array<{ name: string }>).map(
          (row) => row.name,
        );

        expect(tableNames).toEqual(expect.arrayContaining(['task_defs', 'trigger_rules', 'event_events', 'task_runs']));

        upsertTaskDefinition(db, {
          taskId: 'task:tag-child-write',
          taskKind: 'tag_child_write',
          config: { destination: 'children' },
          now: 1,
        });
        upsertTriggerRule(db, {
          triggerId: 'trigger:tag-added',
          triggerKind: 'tag_added',
          taskId: 'task:tag-child-write',
          match: { tag_id: 'tag-1' },
          now: 2,
        });

        const createdFirst = insertEventRecord(db, {
          eventId: 'event-1',
          eventKind: 'tag_added',
          sourceRemId: 'rem-1',
          sourceTagId: 'tag-1',
          dedupeKey: 'tag-added:rem-1:tag-1',
          payload: { rem_id: 'rem-1', tag_id: 'tag-1' },
          now: 3,
        });
        const createdSecond = insertEventRecord(db, {
          eventId: 'event-2',
          eventKind: 'tag_added',
          sourceRemId: 'rem-1',
          sourceTagId: 'tag-1',
          dedupeKey: 'tag-added:rem-1:tag-1',
          payload: { rem_id: 'rem-1', tag_id: 'tag-1' },
          now: 4,
        });

        expect(createdFirst).toBe(true);
        expect(createdSecond).toBe(false);

        db.prepare(
          `INSERT INTO queue_txns(
             txn_id, status, dispatch_mode, priority, meta_json, op_count, next_seq, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run('txn-1', 'succeeded', 'serial', 0, '{}', 0, 0, 5, 5);

        upsertTaskRun(db, {
          runId: 'run-1',
          taskId: 'task:tag-child-write',
          triggerId: 'trigger:tag-added',
          eventId: 'event-1',
          targetRemId: 'rem-1',
          resultRemId: 'result-1',
          queueTxnId: 'txn-1',
          status: 'succeeded',
          detail: { queue_txn_id: 'txn-1' },
          now: 6,
        });

        const run = getTaskRunById(db, 'run-1');
        expect(run).not.toBeNull();
        expect(run?.task_id).toBe('task:tag-child-write');
        expect(run?.trigger_id).toBe('trigger:tag-added');
        expect(run?.event_id).toBe('event-1');
        expect(run?.queue_txn_id).toBe('txn-1');
        expect(run?.result_rem_id).toBe('result-1');
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
