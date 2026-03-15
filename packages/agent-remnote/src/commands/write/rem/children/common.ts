import * as Effect from 'effect/Effect';

import { tryParseRemnoteLink } from '../../../../lib/remnote.js';
import { trimBoundaryBlankLines } from '../../../../lib/text.js';
import { collectSelectionCurrentUseCase, executeWriteApplyUseCase } from '../../../../lib/hostApiUseCases.js';
import { AppConfig } from '../../../../services/AppConfig.js';
import { CliError, isCliError } from '../../../../services/Errors.js';
import { FileInput } from '../../../../services/FileInput.js';
import { HostApiClient } from '../../../../services/HostApiClient.js';
import { Payload } from '../../../../services/Payload.js';
import { Queue } from '../../../../services/Queue.js';
import type { WorkspaceBindings } from '../../../../services/WorkspaceBindings.js';
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
  readonly input?: Record<string, unknown> | undefined;
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
    const input =
      params.input ??
      ({
        rem_id: params.remId,
        ...(params.markdown !== undefined ? { markdown: params.markdown } : {}),
      } satisfies Record<string, unknown>);
    return {
      version: 1,
      kind: 'actions',
      actions: [
        {
          action: params.action,
          input,
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

export function resolveCurrentSelectionRemId(params: {
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
}): Effect.Effect<any, CliError, AppConfig | HostApiClient | any> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const hostApi = yield* HostApiClient;
    const data = cfg.apiBaseUrl
      ? yield* hostApi.selectionCurrent({ baseUrl: cfg.apiBaseUrl, stateFile: params.stateFile, staleMs: params.staleMs })
      : yield* collectSelectionCurrentUseCase({ stateFile: params.stateFile, staleMs: params.staleMs });

    const totalCountRaw = Number(data?.total_count ?? 0);
    const totalCount = Number.isFinite(totalCountRaw) && totalCountRaw >= 0 ? Math.floor(totalCountRaw) : 0;
    const truncated = data?.truncated === true;
    const currentId =
      typeof data?.current?.id === 'string'
        ? data.current.id.trim()
        : Array.isArray(data?.ids)
          ? String(data.ids[0] ?? '').trim()
          : '';

    if (truncated || totalCount !== 1 || !currentId) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'Current selection must resolve to exactly one selected Rem',
          exitCode: 2,
          details: { total_count: totalCount, truncated, current_id: currentId || null, selection: data },
        }),
      );
    }

    return {
      source: 'selection' as const,
      rem_id: currentId,
      selection: data,
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
  AppConfig | Payload | RefResolver | WorkspaceBindings
> {
  return Effect.gen(function* () {
    const payloadSvc = yield* Payload;
    const parsed = yield* Effect.try({
      try: () => parseApplyEnvelope(payloadSvc.normalizeKeys(body)),
      catch: (error) =>
        isCliError(error)
          ? error
          : new CliError({
              code: 'INVALID_PAYLOAD',
              message: String((error as any)?.message || 'Invalid apply envelope'),
              exitCode: 2,
            }),
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

export function loadTxnDetail(params: {
  readonly txnId: string;
}): Effect.Effect<any, CliError, AppConfig | HostApiClient | Queue> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const hostApi = yield* HostApiClient;
    const queue = yield* Queue;
    return cfg.apiBaseUrl
      ? yield* hostApi.queueTxn({ baseUrl: cfg.apiBaseUrl, txnId: params.txnId })
      : yield* queue.inspect({ dbPath: cfg.storeDb, txnId: params.txnId });
  });
}

function parseResultJson(raw: any): any {
  const resultJson = raw?.result_json;
  if (typeof resultJson === 'string' && resultJson.trim()) {
    try {
      return JSON.parse(resultJson);
    } catch {}
  }
  return null;
}

export function extractReplaceBackupSummary(txnDetail: any):
  | {
      readonly policy: string;
      readonly deleted: boolean;
      readonly rem_id: string | null;
      readonly hidden?: boolean | undefined;
      readonly cleanup_state?: string | undefined;
    }
  | undefined {
  const ops = Array.isArray(txnDetail?.ops) ? txnDetail.ops : [];
  const replaceOp = ops.find((op: any) =>
    ['replace_children_with_markdown', 'replace_selection_with_markdown'].includes(String(op?.type ?? '').trim()),
  );
  if (!replaceOp) return undefined;

  const result = parseResultJson(replaceOp.result);
  if (!result || typeof result !== 'object') return undefined;

  return {
    policy:
      typeof result.backup_policy === 'string' && result.backup_policy.trim() ? result.backup_policy.trim() : 'none',
    deleted: result.backup_deleted !== false,
    rem_id:
      typeof result.backup_rem_id === 'string' && result.backup_rem_id.trim() ? result.backup_rem_id.trim() : null,
    ...(result.backup_hidden === true ? { hidden: true } : {}),
    ...(typeof result.backup_cleanup_state === 'string' && result.backup_cleanup_state.trim()
      ? { cleanup_state: result.backup_cleanup_state.trim() }
      : {}),
  };
}
