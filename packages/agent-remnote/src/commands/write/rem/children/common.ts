import * as Effect from 'effect/Effect';

export { extractReplaceBackupSummary } from '../../../../lib/business-semantics/receiptBuilders.js';
import { invokeWave1Capability } from '../../../../lib/business-semantics/modeParityRuntime.js';
import { trimBoundaryBlankLines } from '../../../../lib/text.js';
import { CliError, isCliError } from '../../../../services/Errors.js';
import { FileInput } from '../../../../services/FileInput.js';
import { Payload } from '../../../../services/Payload.js';
import { RemDb } from '../../../../services/RemDb.js';
import { WorkspaceBindings } from '../../../../services/WorkspaceBindings.js';
import { readMarkdownTextFromInputSpec } from '../../../_shared.js';
import { compileApplyEnvelope, parseApplyEnvelope } from '../../../_applyEnvelope.js';
import { RefResolver } from '../../../../services/RefResolver.js';
import { normalizeRefValue, resolveRefValue } from '../../_refValue.js';

export function normalizeRemIdInput(raw: string): string {
  return normalizeRefValue(raw);
}

export function resolveSubjectRemId(
  raw: string,
): Effect.Effect<string, CliError, RefResolver | WorkspaceBindings | any> {
  return resolveRefValue(raw);
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

export type ResolvedSelectionRemIds = {
  readonly source: 'selection';
  readonly rem_ids: readonly string[];
  readonly selection: unknown;
};

export type ResolvedSelectionRemId = {
  readonly source: 'selection';
  readonly rem_id: string;
  readonly selection: unknown;
};

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
}): Effect.Effect<ResolvedSelectionRemId, CliError, RemDb | WorkspaceBindings | any> {
  return Effect.gen(function* () {
    const resolved = yield* resolveCurrentSelectionRemIds(params);
    if (resolved.rem_ids.length !== 1) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'Current selection must resolve to exactly one selected Rem',
          exitCode: 2,
          details: { total_count: resolved.rem_ids.length, selection: resolved.selection },
        }),
      );
    }

    return {
      source: 'selection' as const,
      rem_id: resolved.rem_ids[0]!,
      selection: resolved.selection,
    };
  });
}

export function resolveCurrentSelectionRemIds(params: {
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
}): Effect.Effect<ResolvedSelectionRemIds, CliError, RemDb | WorkspaceBindings | any> {
  return Effect.gen(function* () {
    const data: any = yield* invokeWave1Capability('selection.current', {
      stateFile: params.stateFile,
      staleMs: params.staleMs,
    });

    const totalCountRaw = Number(data?.total_count ?? 0);
    const totalCount = Number.isFinite(totalCountRaw) && totalCountRaw >= 0 ? Math.floor(totalCountRaw) : 0;
    const truncated = data?.truncated === true;
    const listedIds = Array.isArray(data?.ids)
      ? data.ids
          .filter((value: unknown): value is string => typeof value === 'string')
          .map((value: string) => value.trim())
          .filter((value: string) => value.length > 0)
      : [];
    const currentId = typeof data?.current?.id === 'string' && data.current.id.trim() ? data.current.id.trim() : '';
    const ids = listedIds.length > 0 ? listedIds : currentId ? [currentId] : [];

    if (truncated || totalCount < 1 || ids.length === 0 || ids.length !== totalCount) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'Current selection must resolve to one or more selected Rems',
          exitCode: 2,
          details: { total_count: totalCount, truncated, ids, selection: data },
        }),
      );
    }

    return {
      source: 'selection' as const,
      rem_ids: ids,
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
  Payload | RefResolver | WorkspaceBindings | any
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
}): Effect.Effect<any, CliError, Payload | FileInput | any> {
  return Effect.gen(function* () {
    return yield* invokeWave1Capability('write.apply', {
      body: params.body,
      wait: params.wait,
      timeoutMs: params.timeoutMs,
      pollMs: params.pollMs,
    });
  });
}

export function loadTxnDetail(params: {
  readonly txnId: string;
}): Effect.Effect<any, CliError, any> {
  return Effect.gen(function* () {
    return yield* invokeWave1Capability('queue.txn', { txnId: params.txnId });
  });
}
