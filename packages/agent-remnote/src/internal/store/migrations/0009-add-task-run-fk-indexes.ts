import type { StoreDB } from '../db.js';

const IDX_TASK_RUNS_TRIGGER_ID_SQL = `CREATE INDEX IF NOT EXISTS idx_task_runs_trigger_id ON task_runs(trigger_id);`;
const IDX_TASK_RUNS_EVENT_ID_SQL = `CREATE INDEX IF NOT EXISTS idx_task_runs_event_id ON task_runs(event_id);`;

export const migration = {
  version: 9,
  name: 'add_task_run_fk_indexes',
  checksumInput: [IDX_TASK_RUNS_TRIGGER_ID_SQL, IDX_TASK_RUNS_EVENT_ID_SQL].join('\n'),
  apply: (db: StoreDB) => {
    db.exec(IDX_TASK_RUNS_TRIGGER_ID_SQL);
    db.exec(IDX_TASK_RUNS_EVENT_ID_SQL);
  },
} as const;
