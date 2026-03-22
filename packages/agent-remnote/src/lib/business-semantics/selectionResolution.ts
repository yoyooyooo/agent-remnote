import * as Effect from 'effect/Effect';

import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { HostApiClient } from '../../services/HostApiClient.js';
import { RemDb } from '../../services/RemDb.js';
import { WorkspaceBindings } from '../../services/WorkspaceBindings.js';
import { pickClient, readJson, resolveStaleMs, resolveStateFilePath } from '../../commands/ws/bridgeState.js';
import { fetchRemLayouts, listSiblingOrder, resolveLocalDbPath } from './placementResolution.js';

export type SelectionInfo =
  | {
      readonly kind: 'none';
      readonly selectionType?: string;
      readonly updatedAt: number;
    }
  | {
      readonly kind: 'rem';
      readonly selectionType?: string;
      readonly totalCount: number;
      readonly truncated: boolean;
      readonly remIds: readonly string[];
      readonly updatedAt: number;
    }
  | {
      readonly kind: 'text';
      readonly selectionType?: string;
      readonly remId: string;
      readonly range: { start: number; end: number };
      readonly isReverse: boolean;
      readonly updatedAt: number;
    };

export type RemSelectionInfo = Extract<SelectionInfo, { kind: 'rem' }>;
export type TextSelectionInfo = Extract<SelectionInfo, { kind: 'text' }>;

export type BridgeSelectionSnapshot = {
  readonly status: 'off' | 'down' | 'stale' | 'no_client' | 'ok';
  readonly state_file: string;
  readonly updatedAt: number;
  readonly now: number;
  readonly stale_ms: number;
  readonly clients: number;
  readonly selection?: SelectionInfo;
};

export type StableSiblingRange = {
  readonly orderedRemIds: readonly string[];
  readonly parentId: string;
  readonly position: number;
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

function normalizeId(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseSelectionInfo(raw: any): SelectionInfo {
  const kindRaw = typeof raw?.kind === 'string' ? raw.kind.trim() : '';
  const selectionType = typeof raw?.selectionType === 'string' ? raw.selectionType : undefined;
  const updatedAtRaw = Number(raw?.updatedAt ?? 0);
  const updatedAt = Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : 0;

  if (kindRaw === 'text' || (kindRaw === '' && selectionType === 'Text')) {
    const remId = normalizeId(raw?.remId);
    const startRaw = raw?.range?.start;
    const endRaw = raw?.range?.end;
    const start = typeof startRaw === 'number' && Number.isFinite(startRaw) ? Math.floor(startRaw) : NaN;
    const end = typeof endRaw === 'number' && Number.isFinite(endRaw) ? Math.floor(endRaw) : NaN;
    const isReverse = raw?.isReverse === true;

    if (remId && Number.isFinite(start) && Number.isFinite(end) && start !== end) {
      return { kind: 'text', selectionType, remId, range: { start, end }, isReverse, updatedAt };
    }
    return { kind: 'none', selectionType: undefined, updatedAt };
  }

  if (kindRaw === 'rem' || kindRaw === '' || selectionType === 'Rem') {
    const totalCountRaw = Number(raw?.totalCount ?? 0);
    const remIds = Array.isArray(raw?.remIds) ? raw.remIds.map(normalizeId).filter(Boolean) : [];
    const totalCount = Number.isFinite(totalCountRaw) && totalCountRaw >= 0 ? Math.floor(totalCountRaw) : remIds.length;
    const truncated = !!raw?.truncated || totalCount > remIds.length;

    if (remIds.length > 0 || totalCount > 0) {
      return { kind: 'rem', selectionType, totalCount, truncated, remIds, updatedAt };
    }
  }

  return { kind: 'none', selectionType: undefined, updatedAt };
}

export function loadBridgeSelectionSnapshot(params: {
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
  readonly connId?: string | undefined;
}): BridgeSelectionSnapshot {
  const resolved = resolveStateFilePath(params.stateFile);
  const stateFilePath = resolved.path;

  const now = Date.now();
  const staleThreshold = resolveStaleMs(params.staleMs);

  if (resolved.disabled) {
    return {
      status: 'off',
      state_file: stateFilePath,
      updatedAt: 0,
      now,
      stale_ms: staleThreshold,
      clients: 0,
    };
  }

  const state = readJson(stateFilePath);
  if (!state) {
    return {
      status: 'down',
      state_file: stateFilePath,
      updatedAt: 0,
      now,
      stale_ms: staleThreshold,
      clients: 0,
    };
  }

  const updatedAt = Number(state.updatedAt ?? 0);
  const isStale = !Number.isFinite(updatedAt) || updatedAt <= 0 || now - updatedAt > staleThreshold;

  const clients = Array.isArray(state.clients) ? state.clients : [];
  const activeConnIdRaw = typeof state.activeWorkerConnId === 'string' ? state.activeWorkerConnId.trim() : '';
  const client = pickClient(clients, params.connId || activeConnIdRaw || undefined);

  if (!client) {
    return {
      status: 'no_client',
      state_file: stateFilePath,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
      now,
      stale_ms: staleThreshold,
      clients: clients.length,
    };
  }

  const selection = parseSelectionInfo((client as any).selection);

  if (isStale) {
    return {
      status: 'stale',
      state_file: stateFilePath,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
      now,
      stale_ms: staleThreshold,
      clients: clients.length,
      selection,
    };
  }

  return {
    status: 'ok',
    state_file: stateFilePath,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    now,
    stale_ms: staleThreshold,
    clients: clients.length,
    selection,
  };
}

export function requireOkSelection(snapshot: BridgeSelectionSnapshot): Effect.Effect<SelectionInfo, CliError, never> {
  if (snapshot.status === 'ok' && snapshot.selection) {
    return Effect.succeed(snapshot.selection);
  }

  const msg =
    snapshot.status === 'off'
      ? 'WS state is disabled (REMNOTE_WS_STATE_FILE=0)'
      : snapshot.status === 'down'
        ? 'WS state file not found: the daemon may not be running or has not written the state file yet'
        : snapshot.status === 'stale'
          ? 'WS state is stale: the daemon may have stopped or has not updated for a long time'
          : snapshot.status === 'no_client'
            ? 'No RemNote client is currently connected to the daemon'
            : 'Selection is unavailable';

  return Effect.fail(
    new CliError({
      code: 'WS_UNAVAILABLE',
      message: msg,
      exitCode: 1,
      details: snapshot,
    }),
  );
}

export function requireOkRemSelection(
  snapshot: BridgeSelectionSnapshot,
): Effect.Effect<RemSelectionInfo, CliError, never> {
  return requireOkSelection(snapshot).pipe(
    Effect.flatMap((sel) => {
      if (sel.kind === 'rem') return Effect.succeed(sel);
      if (sel.kind === 'text') {
        return Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Current selection is text; this command requires Rem selection',
            exitCode: 2,
            details: snapshot,
          }),
        );
      }
      return Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'No Rem is currently selected',
          exitCode: 2,
          details: snapshot,
        }),
      );
    }),
  );
}

export function requireStableSiblingRange(params: {
  readonly remIds: readonly string[];
  readonly missingMessage: string;
  readonly mismatchMessage: string;
}): Effect.Effect<StableSiblingRange, CliError, AppConfig | HostApiClient | RemDb | WorkspaceBindings> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    if (cfg.apiBaseUrl) {
      const hostApi = yield* HostApiClient;
      const resolved = yield* hostApi.resolveStableSiblingRange({
        baseUrl: cfg.apiBaseUrl,
        body: {
          remIds: params.remIds,
          missingMessage: params.missingMessage,
          mismatchMessage: params.mismatchMessage,
        },
      });

      const orderedRemIds = Array.isArray((resolved as any)?.orderedRemIds)
        ? (resolved as any).orderedRemIds.map(normalizeId).filter(Boolean)
        : [];
      const parentId = normalizeId((resolved as any)?.parentId);
      const positionRaw = Number((resolved as any)?.position);
      const position = Number.isFinite(positionRaw) ? Math.floor(positionRaw) : NaN;

      if (orderedRemIds.length !== params.remIds.length || !parentId || !Number.isFinite(position) || position < 0) {
        return yield* Effect.fail(
          invalidHostResponse('Host API returned an invalid stable sibling range', {
            expected_count: params.remIds.length,
            received: resolved,
          }),
        );
      }

      return {
        orderedRemIds,
        parentId,
        position,
      };
    }

    return yield* requireStableSiblingRangeLocal(params);
  });
}

export function requireStableSiblingRangeLocal(params: {
  readonly remIds: readonly string[];
  readonly missingMessage: string;
  readonly mismatchMessage: string;
}): Effect.Effect<StableSiblingRange, CliError, AppConfig | RemDb | WorkspaceBindings> {
  return Effect.gen(function* () {
    const remDb = yield* RemDb;
    const dbPath = yield* resolveLocalDbPath();
    const layouts = yield* remDb.withDb(dbPath, async (db) => fetchRemLayouts(db, params.remIds)).pipe(
      Effect.map((result) => result.result),
    );

    const entries = params.remIds
      .map((id) => layouts.get(id))
      .filter((value): value is NonNullable<typeof value> => Boolean(value));
    if (entries.length !== params.remIds.length) {
      return yield* Effect.fail(
        invalidArgs(params.missingMessage, {
          expected: params.remIds.length,
          resolved: entries.length,
        }),
      );
    }

    const parentIds = Array.from(
      new Set(entries.map((entry) => entry.parentId).filter((value): value is string => Boolean(value))),
    );
    if (parentIds.length !== 1) {
      return yield* Effect.fail(
        invalidArgs(params.mismatchMessage, {
          parent_count: parentIds.length,
        }),
      );
    }

    const siblingOrder = yield* remDb.withDb(dbPath, async (db) => listSiblingOrder(db, parentIds[0]!)).pipe(
      Effect.map((result) => result.result),
    );
    const indexed = entries
      .map((entry) => ({ id: entry.id, index: siblingOrder.indexOf(entry.id) }))
      .sort((a, b) => a.index - b.index);

    const first = indexed[0];
    if (!first || first.index < 0) {
      return yield* Effect.fail(invalidArgs('Failed to resolve sibling placement'));
    }

    for (let offset = 0; offset < indexed.length; offset += 1) {
      const current = indexed[offset]!;
      if (current.index !== first.index + offset) {
        return yield* Effect.fail(
          invalidArgs(params.mismatchMessage, {
            actual_positions: indexed.map((item) => item.index),
          }),
        );
      }
    }

    return {
      orderedRemIds: indexed.map((item) => item.id),
      parentId: parentIds[0]!,
      position: first.index,
    };
  });
}

export function compactPluginCurrent(data: any) {
  return {
    current_source: readString(data?.current?.source) || 'none',
    current_id: readString(data?.current?.id),
    current_title: readString(data?.current?.title) || undefined,
    page_id: readString(data?.page?.id),
    page_title: readString(data?.page?.title) || undefined,
    focus_id: readString(data?.focus?.id),
    focus_title: readString(data?.focus?.title) || undefined,
    selection_kind: readString(data?.selection?.kind) || 'none',
    selection_count: typeof data?.selection?.total_count === 'number' ? data.selection.total_count : 0,
    selection_truncated: data?.selection?.truncated === true,
    selection_ids: Array.isArray(data?.selection?.ids) ? data.selection.ids.map(String) : [],
  };
}

export function compactSelectionCurrent(data: any) {
  return {
    selection_kind: readString(data?.selection_kind),
    total_count: typeof data?.total_count === 'number' ? data.total_count : 0,
    truncated: data?.truncated === true,
    current_id: readString(data?.current?.id),
    current_title: readString(data?.current?.title) || undefined,
    page_id: readString(data?.page?.id),
    page_title: readString(data?.page?.title) || undefined,
    focus_id: readString(data?.focus?.id),
    focus_title: readString(data?.focus?.title) || undefined,
  };
}
