import * as Effect from 'effect/Effect';

import { tryParseRemnoteLink } from '../../../../lib/remnote.js';
import { trimBoundaryBlankLines } from '../../../../lib/text.js';
import { executeWriteApplyUseCase } from '../../../../lib/hostApiUseCases.js';
import { AppConfig } from '../../../../services/AppConfig.js';
import { CliError } from '../../../../services/Errors.js';
import { FileInput } from '../../../../services/FileInput.js';
import { HostApiClient } from '../../../../services/HostApiClient.js';
import { Payload } from '../../../../services/Payload.js';
import { readMarkdownTextFromInputSpec } from '../../../_shared.js';
import { compileApplyEnvelope, parseApplyEnvelope } from '../../../_applyEnvelope.js';
import { RefResolver } from '../../../../services/RefResolver.js';

export function normalizeRemIdInput(raw: string): string {
  const trimmed = raw.trim();
  const link = tryParseRemnoteLink(trimmed);
  if (link?.remId) return link.remId;
  return trimmed;
}

export function ensureWaitArgs(params: {
  readonly wait: boolean;
  readonly timeoutMs?: number | undefined;
  readonly pollMs?: number | undefined;
  readonly dryRun: boolean;
}): Effect.Effect<void, CliError> {
  return Effect.gen(function* () {
    if (!params.wait && (params.timeoutMs !== undefined || params.pollMs !== undefined)) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'Use --wait to enable --timeout-ms/--poll-ms',
          exitCode: 2,
        }),
      );
    }
    if (params.dryRun && params.wait) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: '--wait is not compatible with --dry-run',
          exitCode: 2,
        }),
      );
    }
  });
}

export function buildActionEnvelope(params: {
  readonly action: string;
  readonly remId: string;
  readonly markdown?: string | undefined;
  readonly priority?: number | undefined;
  readonly clientId?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly metaSpec?: string | undefined;
  readonly notify: boolean;
  readonly ensureDaemon: boolean;
}): Effect.Effect<Record<string, unknown>, CliError, Payload> {
  return Effect.gen(function* () {
    const payloadSvc = yield* Payload;
    const metaValue = params.metaSpec ? yield* payloadSvc.readJson(params.metaSpec) : undefined;
    return {
      version: 1,
      kind: 'actions',
      actions: [
        {
          action: params.action,
          input: {
            rem_id: params.remId,
            ...(params.markdown !== undefined ? { markdown: params.markdown } : {}),
          },
        },
      ],
      ...(params.priority !== undefined ? { priority: params.priority } : {}),
      ...(params.clientId ? { client_id: params.clientId } : {}),
      ...(params.idempotencyKey ? { idempotency_key: params.idempotencyKey } : {}),
      ...(metaValue !== undefined ? { meta: metaValue } : {}),
      notify: params.notify,
      ensure_daemon: params.ensureDaemon,
    };
  });
}

export function readMarkdownArg(inputSpec: string): Effect.Effect<string, CliError, FileInput> {
  return Effect.gen(function* () {
    const raw = yield* readMarkdownTextFromInputSpec(inputSpec);
    return trimBoundaryBlankLines(raw);
  });
}

export function dryRunEnvelope(
  body: Record<string, unknown>,
): Effect.Effect<
  { readonly kind: string; readonly ops: unknown; readonly aliasMap?: unknown },
  CliError,
  AppConfig | Payload | RefResolver
> {
  return Effect.gen(function* () {
    const payloadSvc = yield* Payload;
    const parsed = yield* Effect.try({
      try: () => parseApplyEnvelope(payloadSvc.normalizeKeys(body)),
      catch: (error) =>
        error instanceof Error && 'code' in error
          ? (error as any)
          : new Error(String((error as any)?.message || error)),
    });
    const compiled = yield* compileApplyEnvelope(parsed);
    return {
      kind: compiled.kind,
      ops: compiled.ops,
      aliasMap: compiled.aliasMap,
    };
  });
}

export function submitActionEnvelope(params: {
  readonly body: Record<string, unknown>;
  readonly wait: boolean;
  readonly timeoutMs?: number | undefined;
  readonly pollMs?: number | undefined;
}): Effect.Effect<any, CliError, AppConfig | HostApiClient | Payload | FileInput | any> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const hostApi = yield* HostApiClient;

    if (cfg.apiBaseUrl) {
      const data = yield* hostApi.writeApply({
        baseUrl: cfg.apiBaseUrl,
        body: params.body,
      });
      if (!params.wait) return data;
      const waited = yield* hostApi.queueWait({
        baseUrl: cfg.apiBaseUrl,
        txnId: String(data.txn_id),
        timeoutMs: params.timeoutMs,
        pollMs: params.pollMs,
      });
      return { ...data, ...waited };
    }

    return yield* executeWriteApplyUseCase({
      raw: params.body,
      wait: params.wait,
      timeoutMs: params.timeoutMs,
      pollMs: params.pollMs,
    });
  });
}
