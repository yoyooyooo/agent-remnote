import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

import { CliError } from './Errors.js';
import type { WsRuntimeInfo } from '../kernel/ws-bridge/index.js';

export type WsHealthResult = { readonly url: string; readonly rtt_ms: number };
export type WsTriggerResult = {
  readonly sent: number;
  readonly activeConnId?: string | undefined;
  readonly reason?: string | undefined;
  readonly nextActions?: readonly string[] | undefined;
};
export type WsClientInfo = {
  readonly connId: string;
  readonly clientType?: string | undefined;
  readonly clientInstanceId?: string | null | undefined;
  readonly capabilities?: { control?: boolean; worker?: boolean; readRpc?: boolean; batchPull?: boolean } | undefined;
  readonly isActiveWorker?: boolean | undefined;
  readonly connectedAt: number;
  readonly lastSeenAt: number;
  readonly remoteAddr?: string | undefined;
  readonly readyState: number;
  readonly runtime?: WsRuntimeInfo | undefined;
};
export type WsClientsResult = {
  readonly clients: readonly WsClientInfo[];
  readonly activeWorkerConnId?: string | undefined;
};

export type WsSearchResult = {
  readonly ok: boolean;
  readonly budget: unknown;
  readonly results?: readonly unknown[] | undefined;
  readonly error?: unknown;
  readonly nextActions?: readonly string[] | undefined;
};

export interface WsClientService {
  readonly health: (params: {
    readonly url: string;
    readonly timeoutMs: number;
  }) => Effect.Effect<WsHealthResult, CliError>;
  readonly triggerStartSync: (params: {
    readonly url: string;
    readonly timeoutMs: number;
  }) => Effect.Effect<WsTriggerResult, CliError>;
  readonly queryClients: (params: {
    readonly url: string;
    readonly timeoutMs: number;
  }) => Effect.Effect<WsClientsResult, CliError>;
  readonly search: (params: {
    readonly url: string;
    readonly timeoutMs: number;
    readonly queryText: string;
    readonly searchContextRemId?: string | undefined;
    readonly limit: number;
    readonly rpcTimeoutMs: number;
  }) => Effect.Effect<WsSearchResult, CliError>;
}

export class WsClient extends Context.Tag('WsClient')<WsClient, WsClientService>() {}

function formatError(e: unknown): string {
  if (!e) return 'unknown error';
  if (typeof e === 'string') return e;
  const anyErr = e as any;
  if (anyErr?.errors && Array.isArray(anyErr.errors)) {
    const parts = anyErr.errors
      .map((inner: any) => {
        const code = inner?.code ? String(inner.code) : '';
        const msg = inner?.message ? String(inner.message) : String(inner);
        return code ? `${code}: ${msg}` : msg;
      })
      .filter(Boolean);
    if (parts.length > 0) return `AggregateError(${parts.join('; ')})`;
  }
  if (typeof anyErr?.message === 'string') return anyErr.message;
  return String(e);
}

function timeoutMessage(timeoutMs: number): string {
  return `timeout after ${timeoutMs}ms`;
}

function wsTimeoutError(params: { readonly url: string; readonly timeoutMs: number }): CliError {
  return new CliError({
    code: 'WS_TIMEOUT',
    message: timeoutMessage(params.timeoutMs),
    exitCode: 1,
    details: { url: params.url, timeout_ms: params.timeoutMs },
  });
}

function wsUnavailableError(params: {
  readonly url: string;
  readonly timeoutMs: number;
  readonly error: unknown;
}): CliError {
  return new CliError({
    code: 'WS_UNAVAILABLE',
    message: formatError(params.error),
    exitCode: 1,
    details: { url: params.url, timeout_ms: params.timeoutMs },
  });
}

function acquireWebSocket(url: string): Effect.Effect<WebSocket, unknown> {
  return Effect.async<WebSocket, unknown>((resume, signal) => {
    const ws = new WebSocket(url);

    const cleanup = () => {
      ws.off('open', onOpen);
      ws.off('error', onError);
      ws.off('close', onClose);
      signal.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      try {
        ws.terminate();
      } catch {}
    };

    const onOpen = () => {
      cleanup();
      resume(Effect.succeed(ws));
    };

    const onError = (error: unknown) => {
      cleanup();
      resume(Effect.fail(error));
    };

    const onClose = () => {
      cleanup();
      resume(Effect.fail(new Error('connection closed')));
    };

    ws.on('open', onOpen);
    ws.on('error', onError);
    ws.on('close', onClose);

    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort);
  });
}

function terminateSocket(ws: WebSocket): Effect.Effect<void> {
  return Effect.sync(() => {
    try {
      ws.terminate();
    } catch {}
  });
}

function withWebSocket<A>(params: {
  readonly url: string;
  readonly timeoutMs: number;
  readonly use: (ws: WebSocket) => Effect.Effect<A, CliError>;
}): Effect.Effect<A, CliError> {
  const duration = Math.max(0, params.timeoutMs);
  return Effect.scoped(
    Effect.acquireRelease(
      acquireWebSocket(params.url).pipe(
        Effect.mapError((error) => wsUnavailableError({ url: params.url, timeoutMs: params.timeoutMs, error })),
      ),
      terminateSocket,
    ).pipe(Effect.flatMap(params.use)),
  ).pipe(
    Effect.timeoutFail({ duration, onTimeout: () => wsTimeoutError({ url: params.url, timeoutMs: params.timeoutMs }) }),
  );
}

function sendJson(params: {
  readonly ws: WebSocket;
  readonly url: string;
  readonly timeoutMs: number;
  readonly msg: unknown;
}) {
  return Effect.try({
    try: () => {
      params.ws.send(JSON.stringify(params.msg));
    },
    catch: (error) => wsUnavailableError({ url: params.url, timeoutMs: params.timeoutMs, error }),
  });
}

function awaitFirstJson<A>(params: {
  readonly ws: WebSocket;
  readonly url: string;
  readonly timeoutMs: number;
  readonly match: (msg: any) => A | undefined;
}): Effect.Effect<A, CliError> {
  return Effect.gen(function* () {
    const deferred = yield* Deferred.make<A, CliError>();

    const cleanup = () => {
      params.ws.off('message', onMessage);
      params.ws.off('error', onError);
      params.ws.off('close', onClose);
    };

    const onMessage = (data: any) => {
      const msg = (() => {
        try {
          return JSON.parse(String(data));
        } catch {
          return null;
        }
      })();
      if (msg === null) return;

      const matched = params.match(msg);
      if (matched === undefined) return;

      cleanup();
      Deferred.unsafeDone(deferred, Exit.succeed(matched));
    };

    const onError = (error: unknown) => {
      cleanup();
      Deferred.unsafeDone(
        deferred,
        Exit.fail(wsUnavailableError({ url: params.url, timeoutMs: params.timeoutMs, error })),
      );
    };

    const onClose = () => {
      cleanup();
      Deferred.unsafeDone(
        deferred,
        Exit.fail(
          wsUnavailableError({ url: params.url, timeoutMs: params.timeoutMs, error: new Error('connection closed') }),
        ),
      );
    };

    params.ws.on('message', onMessage);
    params.ws.on('error', onError);
    params.ws.on('close', onClose);

    return yield* Deferred.await(deferred).pipe(Effect.ensuring(Effect.sync(cleanup)));
  });
}

export const WsClientLive = Layer.succeed(WsClient, {
  health: ({ url, timeoutMs }) =>
    withWebSocket({
      url,
      timeoutMs,
      use: (ws) =>
        Effect.gen(function* () {
          const startedAt = yield* Clock.currentTimeMillis;

          yield* sendJson({ ws, url, timeoutMs, msg: { type: 'Hello' } });
          yield* awaitFirstJson({
            ws,
            url,
            timeoutMs,
            match: (msg) => (msg?.type === 'HelloAck' && msg?.ok === true ? true : undefined),
          });

          const endedAt = yield* Clock.currentTimeMillis;
          return { url, rtt_ms: endedAt - startedAt };
        }),
    }),
  triggerStartSync: ({ url, timeoutMs }) =>
    withWebSocket({
      url,
      timeoutMs,
      use: (ws) =>
        Effect.gen(function* () {
          yield* sendJson({ ws, url, timeoutMs, msg: { type: 'TriggerStartSync' } });
          return yield* awaitFirstJson({
            ws,
            url,
            timeoutMs,
            match: (msg) => {
              if (msg?.type !== 'StartSyncTriggered') return undefined;
              return {
                sent: typeof msg?.sent === 'number' ? msg.sent : 0,
                activeConnId: typeof msg?.activeConnId === 'string' ? msg.activeConnId : undefined,
                reason: typeof msg?.reason === 'string' ? msg.reason : undefined,
                nextActions: Array.isArray(msg?.nextActions) ? (msg.nextActions as any) : undefined,
              } satisfies WsTriggerResult;
            },
          });
        }),
    }),
  queryClients: ({ url, timeoutMs }) =>
    withWebSocket({
      url,
      timeoutMs,
      use: (ws) =>
        Effect.gen(function* () {
          yield* sendJson({ ws, url, timeoutMs, msg: { type: 'QueryClients' } });
          return yield* awaitFirstJson({
            ws,
            url,
            timeoutMs,
            match: (msg) => {
              if (msg?.type !== 'Clients' || !Array.isArray(msg?.clients)) return undefined;
              return {
                clients: msg.clients as any,
                activeWorkerConnId: typeof msg?.activeWorkerConnId === 'string' ? msg.activeWorkerConnId : undefined,
              } satisfies WsClientsResult;
            },
          });
        }),
    }),
  search: ({ url, timeoutMs, queryText, searchContextRemId, limit, rpcTimeoutMs }) =>
    withWebSocket({
      url,
      timeoutMs,
      use: (ws) =>
        Effect.gen(function* () {
          const requestId = randomUUID();
          yield* sendJson({
            ws,
            url,
            timeoutMs,
            msg: {
              type: 'SearchRequest',
              requestId,
              queryText,
              searchContextRemId,
              limit,
              timeoutMs: rpcTimeoutMs,
            },
          });

          const result = yield* awaitFirstJson({
            ws,
            url,
            timeoutMs,
            match: (msg) => (msg?.type === 'SearchResponse' && msg?.requestId === requestId ? msg : undefined),
          });

          return {
            ok: result?.ok === true,
            budget: result?.budget ?? {},
            results: Array.isArray(result?.results) ? result.results : undefined,
            error: result?.error,
            nextActions: Array.isArray(result?.nextActions) ? result.nextActions : undefined,
          } satisfies WsSearchResult;
        }),
    }),
} satisfies WsClientService);
