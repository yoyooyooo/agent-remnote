import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import { CliError, type CliErrorCode } from './Errors.js';

type JsonEnvelope =
  | { readonly ok: true; readonly data: unknown }
  | {
      readonly ok: false;
      readonly error?: { readonly code?: string; readonly message?: string; readonly details?: unknown };
      readonly hint?: readonly string[];
    };

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function apiTimeoutError(params: {
  readonly baseUrl: string;
  readonly path: string;
  readonly timeoutMs: number;
}): CliError {
  return new CliError({
    code: 'API_TIMEOUT',
    message: `API timeout after ${params.timeoutMs}ms`,
    exitCode: 1,
    details: { base_url: params.baseUrl, path: params.path, timeout_ms: params.timeoutMs },
  });
}

function apiUnavailableError(params: {
  readonly baseUrl: string;
  readonly path: string;
  readonly error: unknown;
}): CliError {
  return new CliError({
    code: 'API_UNAVAILABLE',
    message: String((params.error as any)?.message || params.error || 'API request failed'),
    exitCode: 1,
    details: { base_url: params.baseUrl, path: params.path },
  });
}

function exitCodeFromRemoteCode(code: string | undefined): 1 | 2 {
  return code === 'INVALID_ARGS' ? 2 : 1;
}

function parseEnvelope(raw: unknown): JsonEnvelope {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: { code: 'INTERNAL', message: 'Invalid API response envelope' } };
  }
  return raw as JsonEnvelope;
}

function buildQuery(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      if (!value.trim()) continue;
      sp.set(key, value);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      sp.set(key, String(value));
    }
  }
  const query = sp.toString();
  return query ? `?${query}` : '';
}

function requestJson<A>(params: {
  readonly baseUrl: string;
  readonly path: string;
  readonly method: 'GET' | 'POST';
  readonly body?: unknown;
  readonly timeoutMs?: number;
}): Effect.Effect<A, CliError> {
  const timeoutMs = Math.max(1, params.timeoutMs ?? 15_000);
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  const url = `${baseUrl}${params.path}`;

  return Effect.async<A, CliError>((resume) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    fetch(url, {
      method: params.method,
      headers: params.method === 'POST' ? { 'content-type': 'application/json' } : undefined,
      body: params.body === undefined ? undefined : JSON.stringify(params.body),
      signal: controller.signal,
    })
      .then(async (response) => {
        clearTimeout(timer);
        let parsed: JsonEnvelope;
        try {
          parsed = parseEnvelope(await response.json());
        } catch (error) {
          resume(
            Effect.fail(
              new CliError({
                code: 'API_UNAVAILABLE',
                message: 'API returned a non-JSON response',
                exitCode: 1,
                details: { url, status: response.status, error: String((error as any)?.message || error) },
              }),
            ),
          );
          return;
        }

        if (parsed.ok === true) {
          resume(Effect.succeed(parsed.data as A));
          return;
        }

        const code = typeof parsed.error?.code === 'string' ? parsed.error.code : 'INTERNAL';
        const message = typeof parsed.error?.message === 'string' ? parsed.error.message : 'API request failed';
        const hint = Array.isArray(parsed.hint) ? parsed.hint.map(String) : undefined;
        resume(
          Effect.fail(
            new CliError({
              code: code as CliErrorCode,
              message,
              exitCode: exitCodeFromRemoteCode(code),
              details: parsed.error?.details,
              hint,
            }),
          ),
        );
      })
      .catch((error) => {
        clearTimeout(timer);
        if ((error as any)?.name === 'AbortError') {
          resume(Effect.fail(apiTimeoutError({ baseUrl, path: params.path, timeoutMs })));
          return;
        }
        resume(Effect.fail(apiUnavailableError({ baseUrl, path: params.path, error })));
      });

    return Effect.sync(() => {
      clearTimeout(timer);
      controller.abort();
    });
  });
}

export interface HostApiClientService {
  readonly health: (params: { readonly baseUrl: string; readonly timeoutMs?: number }) => Effect.Effect<any, CliError>;
  readonly status: (params: { readonly baseUrl: string; readonly timeoutMs?: number }) => Effect.Effect<any, CliError>;
  readonly uiContextSnapshot: (params: {
    readonly baseUrl: string;
    readonly stateFile?: string | undefined;
    readonly staleMs?: number | undefined;
    readonly timeoutMs?: number;
  }) => Effect.Effect<any, CliError>;
  readonly uiContextPage: (params: {
    readonly baseUrl: string;
    readonly stateFile?: string | undefined;
    readonly staleMs?: number | undefined;
    readonly timeoutMs?: number;
  }) => Effect.Effect<any, CliError>;
  readonly uiContextFocusedRem: (params: {
    readonly baseUrl: string;
    readonly stateFile?: string | undefined;
    readonly staleMs?: number | undefined;
    readonly timeoutMs?: number;
  }) => Effect.Effect<any, CliError>;
  readonly uiContextDescribe: (params: {
    readonly baseUrl: string;
    readonly stateFile?: string | undefined;
    readonly staleMs?: number | undefined;
    readonly selectionLimit?: number | undefined;
    readonly timeoutMs?: number;
  }) => Effect.Effect<any, CliError>;
  readonly selectionSnapshot: (params: {
    readonly baseUrl: string;
    readonly stateFile?: string | undefined;
    readonly staleMs?: number | undefined;
    readonly timeoutMs?: number;
  }) => Effect.Effect<any, CliError>;
  readonly selectionRoots: (params: {
    readonly baseUrl: string;
    readonly stateFile?: string | undefined;
    readonly staleMs?: number | undefined;
    readonly timeoutMs?: number;
  }) => Effect.Effect<any, CliError>;
  readonly selectionCurrent: (params: {
    readonly baseUrl: string;
    readonly stateFile?: string | undefined;
    readonly staleMs?: number | undefined;
    readonly timeoutMs?: number;
  }) => Effect.Effect<any, CliError>;
  readonly pluginCurrent: (params: {
    readonly baseUrl: string;
    readonly stateFile?: string | undefined;
    readonly staleMs?: number | undefined;
    readonly selectionLimit?: number | undefined;
    readonly timeoutMs?: number;
  }) => Effect.Effect<any, CliError>;
  readonly selectionOutline: (params: {
    readonly baseUrl: string;
    readonly body: unknown;
    readonly timeoutMs?: number;
  }) => Effect.Effect<any, CliError>;
  readonly uiContext: (params: {
    readonly baseUrl: string;
    readonly timeoutMs?: number;
  }) => Effect.Effect<any, CliError>;
  readonly selection: (params: {
    readonly baseUrl: string;
    readonly timeoutMs?: number;
  }) => Effect.Effect<any, CliError>;
  readonly searchDb: (params: {
    readonly baseUrl: string;
    readonly query: string;
    readonly timeRange?: string | undefined;
    readonly parentId?: string | undefined;
    readonly pagesOnly?: boolean | undefined;
    readonly excludePages?: boolean | undefined;
    readonly limit?: number | undefined;
    readonly offset?: number | undefined;
    readonly timeoutMs?: number | undefined;
  }) => Effect.Effect<any, CliError>;
  readonly searchPlugin: (params: {
    readonly baseUrl: string;
    readonly query: string;
    readonly searchContextRemId?: string | undefined;
    readonly limit?: number | undefined;
    readonly timeoutMs?: number | undefined;
    readonly ensureDaemon?: boolean | undefined;
  }) => Effect.Effect<any, CliError>;
  readonly writeOps: (params: {
    readonly baseUrl: string;
    readonly body: unknown;
    readonly timeoutMs?: number;
  }) => Effect.Effect<any, CliError>;
  readonly writeMarkdown: (params: {
    readonly baseUrl: string;
    readonly body: unknown;
    readonly timeoutMs?: number;
  }) => Effect.Effect<any, CliError>;
  readonly readOutline: (params: {
    readonly baseUrl: string;
    readonly body: unknown;
    readonly timeoutMs?: number;
  }) => Effect.Effect<any, CliError>;
  readonly dailyRemId: (params: {
    readonly baseUrl: string;
    readonly date?: string | undefined;
    readonly offsetDays?: number | undefined;
    readonly timeoutMs?: number;
  }) => Effect.Effect<any, CliError>;
  readonly queueWait: (params: {
    readonly baseUrl: string;
    readonly txnId: string;
    readonly timeoutMs?: number | undefined;
    readonly pollMs?: number | undefined;
  }) => Effect.Effect<any, CliError>;
  readonly queueTxn: (params: {
    readonly baseUrl: string;
    readonly txnId: string;
    readonly timeoutMs?: number;
  }) => Effect.Effect<any, CliError>;
  readonly triggerSync: (params: {
    readonly baseUrl: string;
    readonly timeoutMs?: number;
  }) => Effect.Effect<any, CliError>;
}

export class HostApiClient extends Context.Tag('HostApiClient')<HostApiClient, HostApiClientService>() {}

export const HostApiClientLive = Layer.succeed(HostApiClient, {
  health: ({ baseUrl, timeoutMs }) => requestJson({ baseUrl, path: '/v1/health', method: 'GET', timeoutMs }),
  status: ({ baseUrl, timeoutMs }) => requestJson({ baseUrl, path: '/v1/status', method: 'GET', timeoutMs }),
  uiContextSnapshot: ({ baseUrl, stateFile, staleMs, timeoutMs }) =>
    requestJson({
      baseUrl,
      path: `/v1/plugin/ui-context/snapshot${buildQuery({ stateFile, staleMs })}`,
      method: 'GET',
      timeoutMs,
    }),
  uiContextPage: ({ baseUrl, stateFile, staleMs, timeoutMs }) =>
    requestJson({
      baseUrl,
      path: `/v1/plugin/ui-context/page${buildQuery({ stateFile, staleMs })}`,
      method: 'GET',
      timeoutMs,
    }),
  uiContextFocusedRem: ({ baseUrl, stateFile, staleMs, timeoutMs }) =>
    requestJson({
      baseUrl,
      path: `/v1/plugin/ui-context/focused-rem${buildQuery({ stateFile, staleMs })}`,
      method: 'GET',
      timeoutMs,
    }),
  uiContextDescribe: ({ baseUrl, stateFile, staleMs, selectionLimit, timeoutMs }) =>
    requestJson({
      baseUrl,
      path: `/v1/plugin/ui-context/describe${buildQuery({ stateFile, staleMs, selectionLimit })}`,
      method: 'GET',
      timeoutMs,
    }),
  selectionSnapshot: ({ baseUrl, stateFile, staleMs, timeoutMs }) =>
    requestJson({
      baseUrl,
      path: `/v1/plugin/selection/snapshot${buildQuery({ stateFile, staleMs })}`,
      method: 'GET',
      timeoutMs,
    }),
  selectionRoots: ({ baseUrl, stateFile, staleMs, timeoutMs }) =>
    requestJson({
      baseUrl,
      path: `/v1/plugin/selection/roots${buildQuery({ stateFile, staleMs })}`,
      method: 'GET',
      timeoutMs,
    }),
  selectionCurrent: ({ baseUrl, stateFile, staleMs, timeoutMs }) =>
    requestJson({
      baseUrl,
      path: `/v1/plugin/selection/current${buildQuery({ stateFile, staleMs })}`,
      method: 'GET',
      timeoutMs,
    }),
  pluginCurrent: ({ baseUrl, stateFile, staleMs, selectionLimit, timeoutMs }) =>
    requestJson({
      baseUrl,
      path: `/v1/plugin/current${buildQuery({ stateFile, staleMs, selectionLimit })}`,
      method: 'GET',
      timeoutMs,
    }),
  selectionOutline: ({ baseUrl, body, timeoutMs }) =>
    requestJson({ baseUrl, path: '/v1/plugin/selection/outline', method: 'POST', body, timeoutMs }),
  uiContext: ({ baseUrl, timeoutMs }) => requestJson({ baseUrl, path: '/v1/ui-context', method: 'GET', timeoutMs }),
  selection: ({ baseUrl, timeoutMs }) => requestJson({ baseUrl, path: '/v1/selection', method: 'GET', timeoutMs }),
  searchDb: ({ baseUrl, ...body }) => requestJson({ baseUrl, path: '/v1/search/db', method: 'POST', body }),
  searchPlugin: ({ baseUrl, ...body }) => requestJson({ baseUrl, path: '/v1/search/plugin', method: 'POST', body }),
  writeOps: ({ baseUrl, body, timeoutMs }) =>
    requestJson({ baseUrl, path: '/v1/write/ops', method: 'POST', body, timeoutMs }),
  writeMarkdown: ({ baseUrl, body, timeoutMs }) =>
    requestJson({ baseUrl, path: '/v1/write/markdown', method: 'POST', body, timeoutMs }),
  readOutline: ({ baseUrl, body, timeoutMs }) =>
    requestJson({ baseUrl, path: '/v1/read/outline', method: 'POST', body, timeoutMs }),
  dailyRemId: ({ baseUrl, date, offsetDays, timeoutMs }) =>
    requestJson({
      baseUrl,
      path: `/v1/daily/rem-id${buildQuery({ date, offsetDays })}`,
      method: 'GET',
      timeoutMs,
    }),
  queueWait: ({ baseUrl, txnId, timeoutMs, pollMs }) =>
    requestJson({ baseUrl, path: '/v1/queue/wait', method: 'POST', body: { txnId, timeoutMs, pollMs } }),
  queueTxn: ({ baseUrl, txnId, timeoutMs }) =>
    requestJson({ baseUrl, path: `/v1/queue/txns/${encodeURIComponent(txnId)}`, method: 'GET', timeoutMs }),
  triggerSync: ({ baseUrl, timeoutMs }) =>
    requestJson({ baseUrl, path: '/v1/actions/trigger-sync', method: 'POST', timeoutMs }),
} satisfies HostApiClientService);
