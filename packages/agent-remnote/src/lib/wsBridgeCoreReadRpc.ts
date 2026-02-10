import type { WsConnId } from '../kernel/ws-bridge/index.js';

import type { WsBridgeCoreAction, WsBridgeCoreClientState, WsBridgeCoreConfig, WsBridgeCoreState } from './wsBridgeCoreTypes.js';
import { clampInt } from './wsBridgeCoreUtils.js';

function makeSearchTimeoutTimerId(forwardedRequestId: string): string {
  return `search-timeout:${forwardedRequestId}`;
}

export function abortPendingSearchForConnId(params: {
  readonly now: number;
  readonly state: WsBridgeCoreState;
  readonly config: WsBridgeCoreConfig;
  readonly connId: WsConnId;
}): readonly WsBridgeCoreAction[] {
  const actions: WsBridgeCoreAction[] = [];

  for (const [forwardedRequestId, pending] of params.state.pendingSearchByForwardedRequestId.entries()) {
    if (pending.callerConnId !== params.connId && pending.workerConnId !== params.connId) continue;

    params.state.pendingSearchByForwardedRequestId.delete(forwardedRequestId);
    actions.push({ _tag: 'ClearTimer', id: pending.timeoutTimerId });

    // If the caller disconnected, there is nothing to report.
    if (pending.callerConnId === params.connId) continue;

    actions.push({
      _tag: 'SendJson',
      connId: pending.callerConnId,
      msg: {
        type: 'SearchResponse',
        requestId: pending.originalRequestId,
        ok: false,
        budget: {
          timeoutMs: pending.timeoutMs,
          limitRequested: pending.limitRequested,
          limitEffective: pending.limitEffective,
          limitClamped: pending.limitClamped,
          maxPreviewChars: pending.maxPreviewChars,
          durationMs: params.now - pending.startedAt,
        },
        error: { code: 'BRIDGE_ERROR', message: 'connection closed' },
        nextActions: ['Retry later', 'Reconnect the RemNote plugin', params.config.buildDbFallbackNextAction(pending.queryText)],
      },
    });
  }

  return actions;
}

export function handleSearchTimeout(params: {
  readonly now: number;
  readonly state: WsBridgeCoreState;
  readonly config: WsBridgeCoreConfig;
  readonly forwardedRequestId: string;
}): readonly WsBridgeCoreAction[] {
  const pending = params.state.pendingSearchByForwardedRequestId.get(params.forwardedRequestId);
  if (!pending) return [];
  params.state.pendingSearchByForwardedRequestId.delete(params.forwardedRequestId);

  return [
    {
      _tag: 'SendJson',
      connId: pending.callerConnId,
      msg: {
        type: 'SearchResponse',
        requestId: pending.originalRequestId,
        ok: false,
        budget: {
          timeoutMs: pending.timeoutMs,
          limitRequested: pending.limitRequested,
          limitEffective: pending.limitEffective,
          limitClamped: pending.limitClamped,
          maxPreviewChars: pending.maxPreviewChars,
          durationMs: params.now - pending.startedAt,
        },
        error: { code: 'TIMEOUT', message: 'timeout waiting for plugin response' },
        nextActions: [
          'Retry later',
          'Check that the plugin is connected and responsive',
          params.config.buildDbFallbackNextAction(pending.queryText),
        ],
      },
    },
  ];
}

export function handleSearchRequestMessage(params: {
  readonly now: number;
  readonly state: WsBridgeCoreState;
  readonly config: WsBridgeCoreConfig;
  readonly client: WsBridgeCoreClientState;
  readonly msg: any;
}): readonly WsBridgeCoreAction[] {
  const startedAt = params.now;
  const originalRequestId = typeof params.msg?.requestId === 'string' ? params.msg.requestId.trim() : '';
  const queryText = typeof params.msg?.queryText === 'string' ? params.msg.queryText : '';
  const searchContextRemIdRaw = typeof params.msg?.searchContextRemId === 'string' ? params.msg.searchContextRemId.trim() : '';

  const maxPreviewChars = 200;
  const limitRequested = clampInt(typeof params.msg?.limit === 'number' ? params.msg.limit : 20, 1, 10_000);
  const limitEffective = clampInt(limitRequested, 1, 100);
  const limitClamped = limitEffective !== limitRequested;

  const timeoutRequested = clampInt(typeof params.msg?.timeoutMs === 'number' ? params.msg.timeoutMs : 3000, 1, 60_000);
  const timeoutMs = clampInt(timeoutRequested, 1, 5000);

  const budget = {
    timeoutMs,
    limitRequested,
    limitEffective,
    limitClamped,
    maxPreviewChars,
    durationMs: 0,
  };

  const replyError = (error: { readonly code: string; readonly message: string }, nextActions?: readonly string[]) => {
    return {
      _tag: 'SendJson' as const,
      connId: params.client.connId,
      msg: {
        type: 'SearchResponse',
        requestId: originalRequestId || params.msg?.requestId,
        ok: false,
        budget: { ...budget, durationMs: params.now - startedAt },
        error,
        nextActions,
      },
    };
  };

  if (!originalRequestId) {
    return [{ _tag: 'SendJson', connId: params.client.connId, msg: { type: 'Error', message: 'invalid SearchRequest: missing requestId' } }];
  }
  if (!queryText.trim()) {
    return [replyError({ code: 'VALIDATION_ERROR', message: 'queryText must not be empty' })];
  }

  const activeConnId = params.state.activeWorkerConnId;
  if (!activeConnId) {
    return [
      replyError({ code: 'NO_ACTIVE_WORKER', message: 'no active worker connection' }, [
        'Switch to the target RemNote window to trigger a selection change',
        'Check that the plugin is connected',
        params.config.buildDbFallbackNextAction(queryText),
      ]),
    ];
  }

  const worker = params.state.clients.get(activeConnId);
  if (!worker || !worker.capabilities?.readRpc) {
    return [
      replyError({ code: 'NO_ACTIVE_WORKER', message: 'no active read-rpc worker connection' }, [
        'Reconnect the RemNote plugin',
        'Switch to the target RemNote window to trigger a selection change',
        params.config.buildDbFallbackNextAction(queryText),
      ]),
    ];
  }

  const forwardedRequestId = `${activeConnId}:${startedAt}:${params.state.pendingSearchByForwardedRequestId.size + 1}`;
  const timeoutTimerId = makeSearchTimeoutTimerId(forwardedRequestId);

  return [
    {
      _tag: 'SendJsonWithResult',
      connId: activeConnId,
      msg: {
        type: 'SearchRequest',
        requestId: forwardedRequestId,
        queryText,
        searchContextRemId: searchContextRemIdRaw || undefined,
        limit: limitEffective,
        timeoutMs,
      },
      onResult: (ok) => {
        if (!ok) {
          return [
            replyError({ code: 'BRIDGE_ERROR', message: 'failed to forward request to plugin' }),
          ];
        }

        params.state.pendingSearchByForwardedRequestId.set(forwardedRequestId, {
          callerConnId: params.client.connId,
          workerConnId: activeConnId,
          originalRequestId,
          forwardedRequestId,
          queryText,
          startedAt,
          timeoutMs,
          limitRequested,
          limitEffective,
          limitClamped,
          maxPreviewChars,
          timeoutTimerId,
        });

        return [{ _tag: 'SetTimer', id: timeoutTimerId, delayMs: timeoutMs, event: { _tag: 'SearchTimeout', forwardedRequestId } }];
      },
    },
  ];
}

export function handleSearchResponseMessage(params: {
  readonly now: number;
  readonly state: WsBridgeCoreState;
  readonly clientConnId: WsConnId;
  readonly msg: any;
}): readonly WsBridgeCoreAction[] {
  const forwardedRequestId = typeof params.msg?.requestId === 'string' ? params.msg.requestId.trim() : '';
  if (!forwardedRequestId) {
    return [{ _tag: 'SendJson', connId: params.clientConnId, msg: { type: 'Error', message: 'invalid SearchResponse: missing requestId' } }];
  }

  const pending = params.state.pendingSearchByForwardedRequestId.get(forwardedRequestId);
  if (!pending) return [];

  params.state.pendingSearchByForwardedRequestId.delete(forwardedRequestId);

  const ok = params.msg?.ok === true;
  const budgetFromPlugin = params.msg?.budget && typeof params.msg.budget === 'object' ? params.msg.budget : {};
  const maxPreviewCharsRaw = Number((budgetFromPlugin as any)?.maxPreviewChars ?? pending.maxPreviewChars);
  const maxPreviewChars =
    Number.isFinite(maxPreviewCharsRaw) && maxPreviewCharsRaw > 0 ? Math.floor(maxPreviewCharsRaw) : pending.maxPreviewChars;

  const outMsg: any = {
    type: 'SearchResponse',
    requestId: pending.originalRequestId,
    ok,
    budget: {
      timeoutMs: pending.timeoutMs,
      limitRequested: pending.limitRequested,
      limitEffective: pending.limitEffective,
      limitClamped: pending.limitClamped,
      maxPreviewChars,
      durationMs: params.now - pending.startedAt,
    },
  };

  if (ok) {
    outMsg.results = Array.isArray(params.msg?.results) ? params.msg.results : [];
  } else {
    outMsg.error =
      params.msg?.error && typeof params.msg.error === 'object' ? params.msg.error : { code: 'PLUGIN_ERROR', message: 'unknown error' };
    outMsg.nextActions = Array.isArray(params.msg?.nextActions) ? params.msg.nextActions : undefined;
  }

  return [
    { _tag: 'ClearTimer', id: pending.timeoutTimerId },
    { _tag: 'SendJson', connId: pending.callerConnId, msg: outMsg },
  ];
}
