import type { StoreDB } from './db.js';

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized || null;
}

function nowMs(value?: number): number {
  return Number.isFinite(value) ? Math.floor(value as number) : Date.now();
}

export type TaskRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'aborted';

export type TaskRunRow = {
  readonly run_id: string;
  readonly task_id: string;
  readonly trigger_id: string | null;
  readonly event_id: string | null;
  readonly target_rem_id: string;
  readonly result_rem_id: string | null;
  readonly queue_txn_id: string | null;
  readonly status: TaskRunStatus;
  readonly detail_json: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly finished_at: number | null;
};

export function upsertTaskDefinition(
  db: StoreDB,
  params: {
    readonly taskId: string;
    readonly taskKind: string;
    readonly config?: unknown;
    readonly now?: number | undefined;
  },
): void {
  const taskId = normalizeString(params.taskId);
  const taskKind = normalizeString(params.taskKind);
  if (!taskId || !taskKind) {
    throw new Error(`Missing or invalid taskId/taskKind (taskId="${taskId}", taskKind="${taskKind}")`);
  }

  const currentNow = nowMs(params.now);
  db.prepare(
    `INSERT INTO task_defs(task_id, task_kind, config_json, created_at, updated_at)
     VALUES(@task_id, @task_kind, @config_json, @created_at, @updated_at)
     ON CONFLICT(task_id) DO UPDATE SET
       task_kind=excluded.task_kind,
       config_json=excluded.config_json,
       updated_at=excluded.updated_at`,
  ).run({
    task_id: taskId,
    task_kind: taskKind,
    config_json: JSON.stringify(params.config ?? {}),
    created_at: currentNow,
    updated_at: currentNow,
  });
}

export function upsertTriggerRule(
  db: StoreDB,
  params: {
    readonly triggerId: string;
    readonly triggerKind: string;
    readonly taskId: string;
    readonly enabled?: boolean | undefined;
    readonly match?: unknown;
    readonly now?: number | undefined;
  },
): void {
  const triggerId = normalizeString(params.triggerId);
  const triggerKind = normalizeString(params.triggerKind);
  const taskId = normalizeString(params.taskId);
  if (!triggerId || !triggerKind || !taskId) {
    throw new Error(
      `Missing or invalid triggerId/triggerKind/taskId (triggerId="${triggerId}", triggerKind="${triggerKind}", taskId="${taskId}")`,
    );
  }

  const currentNow = nowMs(params.now);
  db.prepare(
    `INSERT INTO trigger_rules(trigger_id, trigger_kind, task_id, enabled, match_json, created_at, updated_at)
     VALUES(@trigger_id, @trigger_kind, @task_id, @enabled, @match_json, @created_at, @updated_at)
     ON CONFLICT(trigger_id) DO UPDATE SET
       trigger_kind=excluded.trigger_kind,
       task_id=excluded.task_id,
       enabled=excluded.enabled,
       match_json=excluded.match_json,
       updated_at=excluded.updated_at`,
  ).run({
    trigger_id: triggerId,
    trigger_kind: triggerKind,
    task_id: taskId,
    enabled: params.enabled === false ? 0 : 1,
    match_json: JSON.stringify(params.match ?? {}),
    created_at: currentNow,
    updated_at: currentNow,
  });
}

export function insertEventRecord(
  db: StoreDB,
  params: {
    readonly eventId: string;
    readonly eventKind: string;
    readonly dedupeKey: string;
    readonly sourceRemId?: string | null | undefined;
    readonly sourceTagId?: string | null | undefined;
    readonly payload?: unknown;
    readonly now?: number | undefined;
  },
): boolean {
  const eventId = normalizeString(params.eventId);
  const eventKind = normalizeString(params.eventKind);
  const dedupeKey = normalizeString(params.dedupeKey);
  if (!eventId || !eventKind || !dedupeKey) return false;

  const currentNow = nowMs(params.now);
  const result = db
    .prepare(
      `INSERT INTO event_events(event_id, event_kind, source_rem_id, source_tag_id, dedupe_key, payload_json, created_at)
       VALUES(@event_id, @event_kind, @source_rem_id, @source_tag_id, @dedupe_key, @payload_json, @created_at)
       ON CONFLICT(dedupe_key) DO NOTHING`,
    )
    .run({
      event_id: eventId,
      event_kind: eventKind,
      source_rem_id: normalizeNullableString(params.sourceRemId),
      source_tag_id: normalizeNullableString(params.sourceTagId),
      dedupe_key: dedupeKey,
      payload_json: JSON.stringify(params.payload ?? {}),
      created_at: currentNow,
    });

  return Number(result.changes ?? 0) > 0;
}

export function upsertTaskRun(
  db: StoreDB,
  params: {
    readonly runId: string;
    readonly taskId: string;
    readonly targetRemId: string;
    readonly status: TaskRunStatus;
    readonly triggerId?: string | null | undefined;
    readonly eventId?: string | null | undefined;
    readonly resultRemId?: string | null | undefined;
    readonly queueTxnId?: string | null | undefined;
    readonly detail?: unknown;
    readonly now?: number | undefined;
    readonly finishedAt?: number | null | undefined;
  },
): void {
  const runId = normalizeString(params.runId);
  const taskId = normalizeString(params.taskId);
  const targetRemId = normalizeString(params.targetRemId);
  if (!runId || !taskId || !targetRemId) {
    throw new Error(
      `Missing or invalid runId/taskId/targetRemId (runId="${runId}", taskId="${taskId}", targetRemId="${targetRemId}")`,
    );
  }

  const currentNow = nowMs(params.now);
  const finishedAt =
    params.finishedAt === null
      ? null
      : Number.isFinite(params.finishedAt)
        ? Math.floor(params.finishedAt as number)
        : params.status === 'succeeded' || params.status === 'failed' || params.status === 'aborted'
          ? currentNow
          : null;

  db.prepare(
    `INSERT INTO task_runs(
       run_id, task_id, trigger_id, event_id, target_rem_id, result_rem_id, queue_txn_id,
       status, detail_json, created_at, updated_at, finished_at
     ) VALUES(
       @run_id, @task_id, @trigger_id, @event_id, @target_rem_id, @result_rem_id, @queue_txn_id,
       @status, @detail_json, @created_at, @updated_at, @finished_at
     )
     ON CONFLICT(run_id) DO UPDATE SET
       task_id=excluded.task_id,
       trigger_id=excluded.trigger_id,
       event_id=excluded.event_id,
       target_rem_id=excluded.target_rem_id,
       result_rem_id=excluded.result_rem_id,
       queue_txn_id=excluded.queue_txn_id,
       status=excluded.status,
       detail_json=excluded.detail_json,
       updated_at=excluded.updated_at,
       finished_at=excluded.finished_at`,
  ).run({
    run_id: runId,
    task_id: taskId,
    trigger_id: normalizeNullableString(params.triggerId),
    event_id: normalizeNullableString(params.eventId),
    target_rem_id: targetRemId,
    result_rem_id: normalizeNullableString(params.resultRemId),
    queue_txn_id: normalizeNullableString(params.queueTxnId),
    status: params.status,
    detail_json: JSON.stringify(params.detail ?? {}),
    created_at: currentNow,
    updated_at: currentNow,
    finished_at: finishedAt,
  });
}

export function getTaskRunById(db: StoreDB, runId: string): TaskRunRow | null {
  const normalized = normalizeString(runId);
  if (!normalized) return null;
  const row = db.prepare(`SELECT * FROM task_runs WHERE run_id = ?`).get(normalized) as TaskRunRow | undefined;
  return row ?? null;
}
