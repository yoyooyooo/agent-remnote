import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import { openStoreDb, StoreSchemaError } from '../internal/public.js';
import { CliError, isCliError } from './Errors.js';

export type WorkspaceBindingSource = 'explicit' | 'live_ui_context' | 'single_candidate_auto' | 'deep_link';

export type WorkspaceBinding = {
  readonly workspaceId: string;
  readonly kbName?: string | undefined;
  readonly dbPath: string;
  readonly source: WorkspaceBindingSource;
  readonly isCurrent: boolean;
  readonly firstSeenAt: number;
  readonly lastVerifiedAt: number;
  readonly lastUiContextAt?: number | undefined;
  readonly updatedAt: number;
};

export type UpsertWorkspaceBindingInput = {
  readonly storeDbPath: string;
  readonly workspaceId: string;
  readonly kbName?: string | undefined;
  readonly dbPath: string;
  readonly source: WorkspaceBindingSource;
  readonly makeCurrent?: boolean | undefined;
  readonly recordedAt?: number | undefined;
  readonly verifiedAt?: number | undefined;
  readonly lastUiContextAt?: number | undefined;
};

export interface WorkspaceBindingsService {
  readonly getCurrent: (params: { readonly storeDbPath: string }) => Effect.Effect<WorkspaceBinding | undefined, CliError>;
  readonly getByWorkspaceId: (params: {
    readonly storeDbPath: string;
    readonly workspaceId: string;
  }) => Effect.Effect<WorkspaceBinding | undefined, CliError>;
  readonly list: (params: { readonly storeDbPath: string }) => Effect.Effect<readonly WorkspaceBinding[], CliError>;
  readonly upsert: (params: UpsertWorkspaceBindingInput) => Effect.Effect<WorkspaceBinding, CliError>;
}

export class WorkspaceBindings extends Context.Tag('WorkspaceBindings')<
  WorkspaceBindings,
  WorkspaceBindingsService
>() {}

type WorkspaceBindingRow = {
  readonly workspace_id: string;
  readonly kb_name: string | null;
  readonly db_path: string;
  readonly source: WorkspaceBindingSource;
  readonly is_current: number;
  readonly first_seen_at: number;
  readonly last_verified_at: number;
  readonly last_ui_context_at: number | null;
  readonly updated_at: number;
};

function normalizeText(value: string | undefined, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: `${field} must be a non-empty string`,
      exitCode: 2,
      details: { field, value },
    });
  }
  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : undefined;
}

function normalizeTimestamp(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: 'timestamp must be a positive integer',
      exitCode: 2,
      details: { value },
    });
  }
  return Math.floor(value);
}

function mapStoreError(storeDbPath: string, error: StoreSchemaError): CliError {
  const code =
    error.code === 'STORE_SCHEMA_NEWER'
      ? 'QUEUE_SCHEMA_NEWER'
      : error.code === 'STORE_SCHEMA_INVALID'
        ? 'QUEUE_SCHEMA_INVALID'
        : 'QUEUE_SCHEMA_UNKNOWN';
  return new CliError({
    code,
    message: error.message,
    exitCode: 1,
    details: { store_db: storeDbPath, ...(error.details || {}) },
    hint: [...(Array.isArray(error.nextActions) ? error.nextActions : []), 'Override the store db path with --store-db'],
  });
}

function mapRow(row: WorkspaceBindingRow | undefined): WorkspaceBinding | undefined {
  if (!row) return undefined;
  return {
    workspaceId: String(row.workspace_id),
    kbName: row.kb_name ?? undefined,
    dbPath: String(row.db_path),
    source: row.source,
    isCurrent: Number(row.is_current) === 1,
    firstSeenAt: Number(row.first_seen_at),
    lastVerifiedAt: Number(row.last_verified_at),
    lastUiContextAt: row.last_ui_context_at === null ? undefined : Number(row.last_ui_context_at),
    updatedAt: Number(row.updated_at),
  };
}

function withStoreDb<T>(storeDbPath: string, fn: (db: ReturnType<typeof openStoreDb>) => T): T {
  const db = openStoreDb(storeDbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export const WorkspaceBindingsLive = Layer.succeed(WorkspaceBindings, {
  getCurrent: ({ storeDbPath }) =>
    Effect.try({
      try: () =>
        withStoreDb(storeDbPath, (db) =>
          mapRow(
            db
              .prepare(
                `SELECT workspace_id, kb_name, db_path, source, is_current, first_seen_at, last_verified_at, last_ui_context_at, updated_at
                   FROM workspace_bindings
                  WHERE is_current = 1
                  LIMIT 1`,
              )
              .get() as WorkspaceBindingRow | undefined,
          ),
        ),
      catch: (error) => {
        if (isCliError(error)) return error;
        if (error instanceof StoreSchemaError) return mapStoreError(storeDbPath, error);
        return new CliError({
          code: 'QUEUE_UNAVAILABLE',
          message: 'Store database is unavailable',
          exitCode: 1,
          details: { store_db: storeDbPath, error: String((error as any)?.message || error) },
        });
      },
    }),
  getByWorkspaceId: ({ storeDbPath, workspaceId }) =>
    Effect.try({
      try: () =>
        withStoreDb(storeDbPath, (db) =>
          mapRow(
            db
              .prepare(
                `SELECT workspace_id, kb_name, db_path, source, is_current, first_seen_at, last_verified_at, last_ui_context_at, updated_at
                   FROM workspace_bindings
                  WHERE workspace_id = ?
                  LIMIT 1`,
              )
              .get(normalizeText(workspaceId, 'workspaceId')) as WorkspaceBindingRow | undefined,
          ),
        ),
      catch: (error) => {
        if (isCliError(error)) return error;
        if (error instanceof StoreSchemaError) return mapStoreError(storeDbPath, error);
        return new CliError({
          code: 'QUEUE_UNAVAILABLE',
          message: 'Store database is unavailable',
          exitCode: 1,
          details: { store_db: storeDbPath, error: String((error as any)?.message || error) },
        });
      },
    }),
  list: ({ storeDbPath }) =>
    Effect.try({
      try: () =>
        withStoreDb(storeDbPath, (db) => {
          const rows = db
            .prepare(
              `SELECT workspace_id, kb_name, db_path, source, is_current, first_seen_at, last_verified_at, last_ui_context_at, updated_at
                 FROM workspace_bindings
                ORDER BY is_current DESC, updated_at DESC, workspace_id ASC`,
            )
            .all() as WorkspaceBindingRow[];
          return rows.map((row) => mapRow(row)!);
        }),
      catch: (error) => {
        if (isCliError(error)) return error;
        if (error instanceof StoreSchemaError) return mapStoreError(storeDbPath, error);
        return new CliError({
          code: 'QUEUE_UNAVAILABLE',
          message: 'Store database is unavailable',
          exitCode: 1,
          details: { store_db: storeDbPath, error: String((error as any)?.message || error) },
        });
      },
    }),
  upsert: (params) =>
    Effect.try({
      try: () =>
        withStoreDb(params.storeDbPath, (db) => {
          const workspaceId = normalizeText(params.workspaceId, 'workspaceId');
          const dbPath = normalizeText(params.dbPath, 'dbPath');
          const kbName = normalizeOptionalText(params.kbName);
          const now = Math.max(1, Math.floor(Date.now()));
          const recordedAt = normalizeTimestamp(params.recordedAt, now);
          const verifiedAt = normalizeTimestamp(params.verifiedAt, recordedAt);
          const lastUiContextAt =
            params.lastUiContextAt === undefined ? undefined : normalizeTimestamp(params.lastUiContextAt, recordedAt);
          const makeCurrent = params.makeCurrent !== false;

          const tx = db.transaction(() => {
            const existing = db
              .prepare(
                `SELECT workspace_id, kb_name, db_path, source, is_current, first_seen_at, last_verified_at, last_ui_context_at, updated_at
                   FROM workspace_bindings
                  WHERE workspace_id = ?
                  LIMIT 1`,
              )
              .get(workspaceId) as WorkspaceBindingRow | undefined;

            if (makeCurrent) {
              db.prepare(`UPDATE workspace_bindings SET is_current = 0 WHERE workspace_id <> ? AND is_current = 1`).run(
                workspaceId,
              );
            }

            const firstSeenAt = existing ? Number(existing.first_seen_at) : recordedAt;
            const effectiveKbName = kbName ?? (existing?.kb_name ?? undefined);
            const effectiveLastUiContextAt =
              lastUiContextAt ?? (existing?.last_ui_context_at === null ? undefined : existing?.last_ui_context_at ?? undefined);

            db.prepare(
              `INSERT INTO workspace_bindings(
                 workspace_id, kb_name, db_path, source, is_current, first_seen_at, last_verified_at, last_ui_context_at, updated_at
               ) VALUES(
                 @workspace_id, @kb_name, @db_path, @source, @is_current, @first_seen_at, @last_verified_at, @last_ui_context_at, @updated_at
               )
               ON CONFLICT(workspace_id) DO UPDATE SET
                 kb_name = excluded.kb_name,
                 db_path = excluded.db_path,
                 source = excluded.source,
                 is_current = excluded.is_current,
                 last_verified_at = excluded.last_verified_at,
                 last_ui_context_at = excluded.last_ui_context_at,
                 updated_at = excluded.updated_at`,
            ).run({
              workspace_id: workspaceId,
              kb_name: effectiveKbName ?? null,
              db_path: dbPath,
              source: params.source,
              is_current: makeCurrent ? 1 : 0,
              first_seen_at: firstSeenAt,
              last_verified_at: verifiedAt,
              last_ui_context_at: effectiveLastUiContextAt ?? null,
              updated_at: recordedAt,
            });

            return mapRow(
              db
                .prepare(
                  `SELECT workspace_id, kb_name, db_path, source, is_current, first_seen_at, last_verified_at, last_ui_context_at, updated_at
                     FROM workspace_bindings
                    WHERE workspace_id = ?
                    LIMIT 1`,
                )
                .get(workspaceId) as WorkspaceBindingRow | undefined,
            )!;
          });

          return tx();
        }),
      catch: (error) => {
        if (isCliError(error)) return error;
        if (error instanceof StoreSchemaError) return mapStoreError(params.storeDbPath, error);
        return new CliError({
          code: 'QUEUE_UNAVAILABLE',
          message: 'Store database is unavailable',
          exitCode: 1,
          details: { store_db: params.storeDbPath, error: String((error as any)?.message || error) },
        });
      },
    }),
} satisfies WorkspaceBindingsService);
