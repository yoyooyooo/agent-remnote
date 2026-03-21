import * as Effect from 'effect/Effect';

import { resolveWorkspaceSnapshot } from '../../lib/workspaceResolver.js';
import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { RemDb } from '../../services/RemDb.js';
import { RefResolver } from '../../services/RefResolver.js';
import { WorkspaceBindings } from '../../services/WorkspaceBindings.js';
import { failInRemoteMode } from '../_remoteMode.js';

import { normalizeRefValue, resolveRefValue } from './_refValue.js';

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

function invalidPlacementSpec(optionName: string, raw: string): CliError {
  return new CliError({
    code: 'INVALID_ARGS',
    message: `Invalid ${optionName} placement spec: ${raw}`,
    exitCode: 2,
    details: { option: optionName, value: raw },
    hint: [
      `Examples: ${optionName} standalone`,
      `Examples: ${optionName} parent:id:P1`,
      `Examples: ${optionName} parent[2]:id:P1`,
      `Examples: ${optionName} before:id:R1`,
      `Examples: ${optionName} after:id:R1`,
    ],
  });
}

export function parsePlacementSpec(
  raw: string,
  options?: { readonly optionName?: string | undefined; readonly allowStandalone?: boolean | undefined },
): Effect.Effect<PlacementSpec, CliError> {
  return Effect.gen(function* () {
    const optionName = options?.optionName ?? '--at';
    const allowStandalone = options?.allowStandalone !== false;
    const text = raw.trim();

    if (!text) {
      return yield* Effect.fail(
        invalidArgs(`${optionName} requires a placement spec`, { option: optionName, value: raw }),
      );
    }

    if (text === 'standalone') {
      if (!allowStandalone) {
        return yield* Effect.fail(
          invalidArgs(`${optionName} does not allow standalone placement`, { option: optionName, value: raw }),
        );
      }
      return { kind: 'standalone' } satisfies PlacementSpec;
    }

    const parentMatch = /^parent(?:\[(\d+)\])?:(.+)$/.exec(text);
    if (parentMatch) {
      const positionText = parentMatch[1];
      const parentRef = normalizeRefValue(parentMatch[2] ?? '');
      if (!parentRef) {
        return yield* Effect.fail(invalidPlacementSpec(optionName, raw));
      }
      const parsedPosition = positionText === undefined ? undefined : Number.parseInt(positionText, 10);
      if (positionText !== undefined && (parsedPosition === undefined || !Number.isFinite(parsedPosition) || parsedPosition < 0)) {
        return yield* Effect.fail(invalidPlacementSpec(optionName, raw));
      }
      const position = parsedPosition;

      return {
        kind: 'parent',
        parentRef,
        ...(position !== undefined ? { position } : {}),
      } satisfies PlacementSpec;
    }

    const beforeMatch = /^before:(.+)$/.exec(text);
    if (beforeMatch) {
      const anchorRef = normalizeRefValue(beforeMatch[1] ?? '');
      if (!anchorRef) {
        return yield* Effect.fail(invalidPlacementSpec(optionName, raw));
      }
      return { kind: 'before', anchorRef } satisfies PlacementSpec;
    }

    const afterMatch = /^after:(.+)$/.exec(text);
    if (afterMatch) {
      const anchorRef = normalizeRefValue(afterMatch[1] ?? '');
      if (!anchorRef) {
        return yield* Effect.fail(invalidPlacementSpec(optionName, raw));
      }
      return { kind: 'after', anchorRef } satisfies PlacementSpec;
    }

    return yield* Effect.fail(invalidPlacementSpec(optionName, raw));
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
}): Effect.Effect<{ readonly parentId: string; readonly position: number }, CliError, AppConfig | RefResolver | RemDb | WorkspaceBindings> {
  return Effect.gen(function* () {
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
): Effect.Effect<ResolvedPlacement, CliError, AppConfig | RefResolver | RemDb | WorkspaceBindings> {
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
): Effect.Effect<{ readonly parentId: string; readonly position?: number | undefined; readonly kind: 'parent' | 'before' | 'after' }, CliError, AppConfig | RefResolver | RemDb | WorkspaceBindings> {
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
