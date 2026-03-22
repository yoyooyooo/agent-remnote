import * as Effect from 'effect/Effect';

import { resolveWorkspaceSnapshot } from '../workspaceResolver.js';
import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { HostApiClient } from '../../services/HostApiClient.js';
import { RemDb } from '../../services/RemDb.js';
import { RefResolver } from '../../services/RefResolver.js';
import { WorkspaceBindings } from '../../services/WorkspaceBindings.js';
import { failInRemoteMode } from '../../commands/_remoteMode.js';
import { resolveRefValue } from '../../commands/write/_refValue.js';

export type PlacementSpec =
  | { readonly kind: 'standalone' }
  | { readonly kind: 'parent'; readonly parentRef: string; readonly position?: number | undefined }
  | { readonly kind: 'before'; readonly anchorRef: string }
  | { readonly kind: 'after'; readonly anchorRef: string };

export type ResolvedPlacement =
  | { readonly kind: 'standalone' }
  | { readonly kind: 'parent'; readonly parentId: string; readonly position?: number | undefined }
  | { readonly kind: 'before'; readonly parentId: string; readonly position: number }
  | { readonly kind: 'after'; readonly parentId: string; readonly position: number };

export type RemLayout = {
  readonly id: string;
  readonly parentId: string | null;
  readonly sortKey: string | null;
};

function invalidArgs(message: string, details?: Record<string, unknown>): CliError {
  return new CliError({
    code: 'INVALID_ARGS',
    message,
    exitCode: 2,
    details,
  });
}

function invalidHostResponse(message: string, details?: Record<string, unknown>): CliError {
  return new CliError({
    code: 'API_UNAVAILABLE',
    message,
    exitCode: 1,
    details,
  });
}

export function fetchRemLayouts(db: any, ids: readonly string[]): Map<string, RemLayout> {
  const unique = Array.from(new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean)));
  if (unique.length === 0) return new Map();

  const placeholders = unique.map(() => '?').join(',');
  const stmt = db.prepare(
    `SELECT _id AS id,
            json_extract(doc, '$.parent') AS parentId,
            json_extract(doc, '$.f') AS sortKey
       FROM quanta
      WHERE _id IN (${placeholders})`,
  );
  const rows = stmt.all(...unique) as Array<{ id: string; parentId: unknown; sortKey: unknown }>;

  const out = new Map<string, RemLayout>();
  for (const row of rows) {
    const id = String(row.id ?? '').trim();
    if (!id) continue;
    out.set(id, {
      id,
      parentId: typeof row.parentId === 'string' && row.parentId.trim() ? row.parentId.trim() : null,
      sortKey: typeof row.sortKey === 'string' && row.sortKey.trim() ? row.sortKey.trim() : null,
    });
  }
  return out;
}

export function listSiblingOrder(db: any, parentId: string): readonly string[] {
  const stmt = db.prepare(
    `SELECT _id AS id
       FROM quanta
      WHERE json_extract(doc, '$.parent') = ?
      ORDER BY json_extract(doc, '$.f')`,
  );
  const rows = stmt.all(parentId) as Array<{ id: string }>;
  return rows.map((row) => String(row.id ?? '').trim()).filter(Boolean);
}

export function resolveLocalDbPath(): Effect.Effect<string, CliError, AppConfig | WorkspaceBindings> {
  return Effect.gen(function* () {
    yield* failInRemoteMode({
      command: 'write placement resolution',
      reason: 'this path still reads local RemNote hierarchy metadata to resolve before/after placement',
    });

    const cfg = yield* AppConfig;
    if (cfg.remnoteDb) return cfg.remnoteDb;

    const workspace = yield* resolveWorkspaceSnapshot({}).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    const dbPath = workspace?.resolved ? workspace.dbPath : undefined;
    if (dbPath) return dbPath;

    return yield* Effect.fail(
      new CliError({
        code: 'WORKSPACE_UNRESOLVED',
        message: 'Workspace is unresolved for write placement resolution',
        exitCode: 1,
      }),
    );
  });
}

export function resolveAnchorPlacement(params: {
  readonly anchorRef: string;
  readonly offset: 0 | 1;
}): Effect.Effect<
  { readonly parentId: string; readonly position: number },
  CliError,
  AppConfig | HostApiClient | RefResolver | RemDb | WorkspaceBindings
> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    if (cfg.apiBaseUrl) {
      const hostApi = yield* HostApiClient;
      const resolved = yield* hostApi.resolvePlacement({
        baseUrl: cfg.apiBaseUrl,
        body: {
          spec: {
            kind: params.offset === 0 ? 'before' : 'after',
            anchorRef: params.anchorRef,
          },
        },
      });
      const parentId = typeof resolved?.parentId === 'string' ? resolved.parentId.trim() : '';
      const positionRaw = typeof resolved?.position === 'number' ? resolved.position : Number(resolved?.position);
      const position = Number.isFinite(positionRaw) ? Math.floor(positionRaw) : NaN;
      if (!parentId || !Number.isFinite(position) || position < 0) {
        return yield* Effect.fail(
          invalidHostResponse('Host API returned invalid placement coordinates', {
            response: resolved,
            anchor_ref: params.anchorRef,
            offset: params.offset,
          }),
        );
      }
      return {
        parentId,
        position,
      };
    }

    const remDb = yield* RemDb;
    const dbPath = yield* resolveLocalDbPath();
    const anchorId = yield* resolveRefValue(params.anchorRef);
    const layouts = yield* remDb.withDb(dbPath, async (db) => fetchRemLayouts(db, [anchorId])).pipe(
      Effect.map((result) => result.result),
    );
    const layout = layouts.get(anchorId);

    if (!layout) {
      return yield* Effect.fail(
        invalidArgs(`Anchor Rem not found: ${params.anchorRef}`, { anchor_ref: params.anchorRef }),
      );
    }
    if (!layout.parentId) {
      return yield* Effect.fail(
        invalidArgs('Anchor-relative placement requires an anchor with a parent (top-level anchors are unsupported)', {
          anchor_ref: params.anchorRef,
          anchor_id: anchorId,
        }),
      );
    }

    const siblingOrder = yield* remDb.withDb(dbPath, async (db) => listSiblingOrder(db, layout.parentId!)).pipe(
      Effect.map((result) => result.result),
    );
    const index = siblingOrder.indexOf(anchorId);
    if (index < 0) {
      return yield* Effect.fail(
        invalidArgs('Failed to resolve anchor sibling position', {
          anchor_ref: params.anchorRef,
          anchor_id: anchorId,
        }),
      );
    }

    return {
      parentId: layout.parentId,
      position: index + params.offset,
    };
  });
}

export function resolvePlacementSpec(
  spec: PlacementSpec,
): Effect.Effect<ResolvedPlacement, CliError, AppConfig | HostApiClient | RefResolver | RemDb | WorkspaceBindings> {
  return Effect.gen(function* () {
    switch (spec.kind) {
      case 'standalone':
        return { kind: 'standalone' } as const;
      case 'parent':
        return {
          kind: 'parent',
          parentId: yield* resolveRefValue(spec.parentRef),
          ...(spec.position !== undefined ? { position: spec.position } : {}),
        } as const;
      case 'before': {
        const resolved = yield* resolveAnchorPlacement({ anchorRef: spec.anchorRef, offset: 0 });
        return { kind: 'before', parentId: resolved.parentId, position: resolved.position } as const;
      }
      case 'after': {
        const resolved = yield* resolveAnchorPlacement({ anchorRef: spec.anchorRef, offset: 1 });
        return { kind: 'after', parentId: resolved.parentId, position: resolved.position } as const;
      }
    }
  });
}

export function resolveTreePlacementSpec(
  spec: PlacementSpec,
  options?: { readonly optionName?: string | undefined },
): Effect.Effect<
  { readonly parentId: string; readonly position?: number | undefined; readonly kind: 'parent' | 'before' | 'after' },
  CliError,
  AppConfig | HostApiClient | RefResolver | RemDb | WorkspaceBindings
> {
  return Effect.gen(function* () {
    const optionName = options?.optionName ?? '--at';
    const resolved = yield* resolvePlacementSpec(spec);
    if (resolved.kind === 'standalone') {
      return yield* Effect.fail(
        invalidArgs(`${optionName} does not allow standalone placement`, { option: optionName }),
      );
    }
    return resolved;
  });
}
