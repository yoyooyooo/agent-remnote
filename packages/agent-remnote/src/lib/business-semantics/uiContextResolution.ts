import * as Effect from 'effect/Effect';

import { CliError } from '../../services/Errors.js';
import { pickClient, readJson, resolveStaleMs, resolveStateFilePath } from '../../commands/ws/bridgeState.js';

export type UiContextInfo = {
  readonly url: string;
  readonly paneId: string;
  readonly pageRemId: string;
  readonly focusedRemId: string;
  readonly focusedPortalId: string;
  readonly kbId?: string;
  readonly kbName?: string;
  readonly source?: string;
  readonly updatedAt: number;
};

export type BridgeUiContextSnapshot = {
  readonly status: 'off' | 'down' | 'stale' | 'no_client' | 'no_ui_context' | 'ok';
  readonly state_file: string;
  readonly updatedAt: number;
  readonly now: number;
  readonly stale_ms: number;
  readonly clients: number;
  readonly ui_context?: UiContextInfo;
};

export function loadBridgeUiContextSnapshot(params: {
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
  readonly connId?: string | undefined;
}): BridgeUiContextSnapshot {
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

  if (!client.uiContext || typeof client.uiContext !== 'object') {
    return {
      status: 'no_ui_context',
      state_file: stateFilePath,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
      now,
      stale_ms: staleThreshold,
      clients: clients.length,
    };
  }

  const url = typeof client.uiContext?.url === 'string' ? client.uiContext.url : '';
  const paneId = typeof client.uiContext?.paneId === 'string' ? client.uiContext.paneId : '';
  const pageRemId = typeof client.uiContext?.pageRemId === 'string' ? client.uiContext.pageRemId : '';
  const focusedRemId = typeof client.uiContext?.focusedRemId === 'string' ? client.uiContext.focusedRemId : '';
  const focusedPortalId = typeof client.uiContext?.focusedPortalId === 'string' ? client.uiContext.focusedPortalId : '';
  const kbId = typeof client.uiContext?.kbId === 'string' ? client.uiContext.kbId : undefined;
  const kbName = typeof client.uiContext?.kbName === 'string' ? client.uiContext.kbName : undefined;
  const source = typeof client.uiContext?.source === 'string' ? client.uiContext.source : undefined;
  const ctxUpdatedAtRaw = Number(client.uiContext?.updatedAt ?? 0);
  const ctxUpdatedAt = Number.isFinite(ctxUpdatedAtRaw) && ctxUpdatedAtRaw > 0 ? ctxUpdatedAtRaw : 0;

  const uiContext: UiContextInfo = {
    url,
    paneId,
    pageRemId,
    focusedRemId,
    focusedPortalId,
    kbId,
    kbName,
    source,
    updatedAt: ctxUpdatedAt,
  };

  if (isStale) {
    return {
      status: 'stale',
      state_file: stateFilePath,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
      now,
      stale_ms: staleThreshold,
      clients: clients.length,
      ui_context: uiContext,
    };
  }

  return {
    status: 'ok',
    state_file: stateFilePath,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    now,
    stale_ms: staleThreshold,
    clients: clients.length,
    ui_context: uiContext,
  };
}

export function requireOkUiContext(snapshot: BridgeUiContextSnapshot): Effect.Effect<UiContextInfo, CliError, never> {
  if (snapshot.status === 'ok' && snapshot.ui_context) {
    return Effect.succeed(snapshot.ui_context);
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
            : snapshot.status === 'no_ui_context'
              ? 'The active RemNote client has not reported UI context yet'
            : 'UI context is unavailable';

  return Effect.fail(
    new CliError({
      code: 'WS_UNAVAILABLE',
      message: msg,
      exitCode: 1,
      details: snapshot,
    }),
  );
}
