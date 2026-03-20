import type { StoreDB } from './db.js';

export type { StoreDB } from './db.js';
export { StoreSchemaError, defaultLegacyQueuePath, defaultStorePath, ensureDir, openStoreDb } from './db.js';

export type BackupKind = 'children_replace' | 'selection_replace';
export type CleanupPolicy = 'auto' | 'visible';
export type CleanupState = 'pending' | 'orphan' | 'retained' | 'cleaned';

export type BackupArtifactRow = {
  readonly source_op_id: string;
  readonly source_txn: string;
  readonly source_op_type: string;
  readonly backup_kind: BackupKind;
  readonly cleanup_policy: CleanupPolicy;
  readonly cleanup_state: CleanupState;
  readonly backup_rem_id: string | null;
  readonly source_parent_id: string | null;
  readonly source_anchor_id: string | null;
  readonly result_json: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly cleaned_at: number | null;
};

export {
  getTaskRunById,
  insertEventRecord,
  type TaskRunRow,
  upsertTaskDefinition,
  upsertTaskRun,
  upsertTriggerRule,
  type TaskRunStatus,
} from './automationDao.js';

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized || null;
}

export function upsertBackupArtifact(
  db: StoreDB,
  params: {
    readonly sourceOpId: string;
    readonly sourceTxn: string;
    readonly sourceOpType: string;
    readonly backupKind: BackupKind;
    readonly cleanupPolicy: CleanupPolicy;
    readonly cleanupState: CleanupState;
    readonly backupRemId?: string | null | undefined;
    readonly sourceParentId?: string | null | undefined;
    readonly sourceAnchorId?: string | null | undefined;
    readonly result?: unknown;
    readonly now?: number | undefined;
    readonly cleanedAt?: number | null | undefined;
  },
): void {
  const sourceOpId = normalizeString(params.sourceOpId);
  const sourceTxn = normalizeString(params.sourceTxn);
  const sourceOpType = normalizeString(params.sourceOpType);
  if (!sourceOpId || !sourceTxn || !sourceOpType) return;

  const now = Number.isFinite(params.now) ? Math.floor(params.now!) : Date.now();
  const existing = db.prepare(`SELECT created_at FROM backup_artifacts WHERE source_op_id=?`).get(sourceOpId) as any;
  const createdAt = Number.isFinite(existing?.created_at) ? Math.floor(existing.created_at) : now;
  const cleanedAt =
    params.cleanedAt === null
      ? null
      : Number.isFinite(params.cleanedAt)
        ? Math.floor(params.cleanedAt!)
        : params.cleanupState === 'cleaned'
          ? now
          : null;

  db.prepare(
    `INSERT INTO backup_artifacts(
       source_op_id, source_txn, source_op_type, backup_kind, cleanup_policy, cleanup_state,
       backup_rem_id, source_parent_id, source_anchor_id, result_json, created_at, updated_at, cleaned_at
     ) VALUES (
       @source_op_id, @source_txn, @source_op_type, @backup_kind, @cleanup_policy, @cleanup_state,
       @backup_rem_id, @source_parent_id, @source_anchor_id, @result_json, @created_at, @updated_at, @cleaned_at
     )
     ON CONFLICT(source_op_id) DO UPDATE SET
       source_txn=excluded.source_txn,
       source_op_type=excluded.source_op_type,
       backup_kind=excluded.backup_kind,
       cleanup_policy=excluded.cleanup_policy,
       cleanup_state=excluded.cleanup_state,
       backup_rem_id=excluded.backup_rem_id,
       source_parent_id=excluded.source_parent_id,
       source_anchor_id=excluded.source_anchor_id,
       result_json=excluded.result_json,
       updated_at=excluded.updated_at,
       cleaned_at=excluded.cleaned_at`,
  ).run({
    source_op_id: sourceOpId,
    source_txn: sourceTxn,
    source_op_type: sourceOpType,
    backup_kind: params.backupKind,
    cleanup_policy: params.cleanupPolicy,
    cleanup_state: params.cleanupState,
    backup_rem_id: normalizeNullableString(params.backupRemId),
    source_parent_id: normalizeNullableString(params.sourceParentId),
    source_anchor_id: normalizeNullableString(params.sourceAnchorId),
    result_json: JSON.stringify(params.result ?? {}),
    created_at: createdAt,
    updated_at: now,
    cleaned_at: cleanedAt,
  });
}

export function listBackupArtifacts(
  db: StoreDB,
  params?: {
    readonly states?: readonly CleanupState[] | undefined;
    readonly kinds?: readonly BackupKind[] | undefined;
    readonly backupRemId?: string | undefined;
    readonly olderThanHours?: number | undefined;
    readonly limit?: number | undefined;
    readonly includeCleaned?: boolean | undefined;
  },
): readonly BackupArtifactRow[] {
  const states = Array.isArray(params?.states) && params!.states.length > 0 ? Array.from(new Set(params!.states)) : [];
  const kinds = Array.isArray(params?.kinds) && params!.kinds.length > 0 ? Array.from(new Set(params!.kinds)) : [];
  const limitRaw = Number(params?.limit ?? 100);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, Math.floor(limitRaw)) : 100;
  const where: string[] = [];
  const args: unknown[] = [];

  if (!params?.includeCleaned && states.length === 0) {
    where.push(`cleanup_state != 'cleaned'`);
  }

  if (states.length > 0) {
    where.push(`cleanup_state IN (${states.map(() => '?').join(', ')})`);
    args.push(...states);
  }

  if (kinds.length > 0) {
    where.push(`backup_kind IN (${kinds.map(() => '?').join(', ')})`);
    args.push(...kinds);
  }

  const backupRemId = normalizeString(params?.backupRemId);
  if (backupRemId) {
    where.push(`backup_rem_id = ?`);
    args.push(backupRemId);
  }

  const olderThanHours = Number(params?.olderThanHours);
  if (Number.isFinite(olderThanHours) && olderThanHours > 0) {
    where.push(`created_at <= ?`);
    args.push(Date.now() - Math.floor(olderThanHours * 60 * 60 * 1000));
  }

  const sql =
    `SELECT * FROM backup_artifacts` +
    (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY updated_at DESC LIMIT ${limit}`;

  return db.prepare(sql).all(...args) as BackupArtifactRow[];
}

export function updateBackupArtifactsCleanupState(
  db: StoreDB,
  params: {
    readonly sourceOpIds: readonly string[];
    readonly cleanupState: CleanupState;
    readonly now?: number | undefined;
  },
): number {
  const sourceOpIds = Array.from(new Set(params.sourceOpIds.map((item) => normalizeString(item)).filter(Boolean)));
  if (sourceOpIds.length === 0) return 0;

  const now = Number.isFinite(params.now) ? Math.floor(params.now!) : Date.now();
  const cleanedAt = params.cleanupState === 'cleaned' ? now : null;
  const result = db
    .prepare(
      `UPDATE backup_artifacts
       SET cleanup_state=?, updated_at=?, cleaned_at=?
       WHERE source_op_id IN (${sourceOpIds.map(() => '?').join(', ')})`,
    )
    .run(params.cleanupState, now, cleanedAt, ...sourceOpIds);
  return Number(result.changes ?? 0);
}
