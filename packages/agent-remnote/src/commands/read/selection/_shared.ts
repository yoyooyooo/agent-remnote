import * as Effect from 'effect/Effect';
import { CliError } from '../../../services/Errors.js';
import { pickClient, readJson, resolveStaleMs, resolveStateFilePath } from '../../ws/bridgeState.js';

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

function normalizeId(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
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
