import * as Effect from 'effect/Effect';

import { compileWritePlanV1 } from '../kernel/write-plan/index.js';
import { AppConfig } from '../services/AppConfig.js';
import { CliError, isCliError } from '../services/Errors.js';
import { Payload } from '../services/Payload.js';
import { RefResolver } from '../services/RefResolver.js';

import { normalizeOp, normalizeOps } from './_enqueue.js';
import { resolveRefsInPayload } from './_resolveRefsInPayload.js';
import { makeTempId } from './_tempId.js';

type ApplyActionInput = {
  readonly action: string;
  readonly input: Record<string, unknown>;
  readonly as?: string | undefined;
};

export type ParsedApplyEnvelope =
  | {
      readonly version: 1;
      readonly kind: 'actions';
      readonly actions: readonly ApplyActionInput[];
      readonly priority?: number | undefined;
      readonly clientId?: string | undefined;
      readonly idempotencyKey?: string | undefined;
      readonly meta?: unknown;
      readonly notify?: boolean | undefined;
      readonly ensureDaemon?: boolean | undefined;
    }
  | {
      readonly version: 1;
      readonly kind: 'ops';
      readonly ops: readonly any[];
      readonly priority?: number | undefined;
      readonly clientId?: string | undefined;
      readonly idempotencyKey?: string | undefined;
      readonly meta?: unknown;
      readonly notify?: boolean | undefined;
      readonly ensureDaemon?: boolean | undefined;
    };

export type CompiledApplyEnvelope = {
  readonly kind: 'actions' | 'ops';
  readonly ops: readonly ReturnType<typeof normalizeOp>[];
  readonly aliasMap?: Readonly<Record<string, string>> | undefined;
  readonly priority?: number | undefined;
  readonly clientId?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly meta?: unknown;
  readonly notify?: boolean | undefined;
  readonly ensureDaemon?: boolean | undefined;
};

function asObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function readOptionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readOptionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readOptionalBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const value = obj[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function parseApplyEnvelope(raw: unknown): ParsedApplyEnvelope {
  const obj = asObject(raw);
  if (!obj) {
    throw new CliError({
      code: 'INVALID_PAYLOAD',
      message: 'Invalid apply envelope: expected an object',
      exitCode: 2,
    });
  }

  const version = obj.version;
  if (version !== 1) {
    throw new CliError({
      code: 'INVALID_PAYLOAD',
      message: 'Invalid apply envelope: expected version=1',
      exitCode: 2,
    });
  }

  const kind = typeof obj.kind === 'string' ? obj.kind.trim() : '';
  const shared = {
    version: 1 as const,
    priority: readOptionalNumber(obj, 'priority'),
    clientId: readOptionalString(obj, 'client_id'),
    idempotencyKey: readOptionalString(obj, 'idempotency_key'),
    meta: obj.meta,
    notify: readOptionalBoolean(obj, 'notify'),
    ensureDaemon: readOptionalBoolean(obj, 'ensure_daemon'),
  };

  if (kind === 'ops') {
    if (!Array.isArray(obj.ops) || obj.ops.length === 0) {
      throw new CliError({
        code: 'INVALID_PAYLOAD',
        message: 'Invalid apply envelope: ops must be a non-empty array',
        exitCode: 2,
      });
    }
    return { ...shared, kind: 'ops', ops: obj.ops };
  }

  if (kind === 'actions') {
    if (!Array.isArray(obj.actions) || obj.actions.length === 0) {
      throw new CliError({
        code: 'INVALID_PAYLOAD',
        message: 'Invalid apply envelope: actions must be a non-empty array',
        exitCode: 2,
      });
    }

    const actions: ApplyActionInput[] = obj.actions.map((value, index) => {
      const item = asObject(value);
      if (!item) {
        throw new CliError({
          code: 'INVALID_PAYLOAD',
          message: `Invalid action at index ${index}: expected an object`,
          exitCode: 2,
        });
      }
      const action = readOptionalString(item, 'action');
      if (!action) {
        throw new CliError({
          code: 'INVALID_PAYLOAD',
          message: `Invalid action at index ${index}: action is required`,
          exitCode: 2,
        });
      }
      const input = asObject(item.input);
      if (!input) {
        throw new CliError({
          code: 'INVALID_PAYLOAD',
          message: `Invalid action at index ${index}: input must be an object`,
          exitCode: 2,
        });
      }
      const as = readOptionalString(item, 'as');
      return { action, input, ...(as ? { as } : {}) };
    });

    return { ...shared, kind: 'actions', actions };
  }

  throw new CliError({
    code: 'INVALID_PAYLOAD',
    message: 'Invalid apply envelope: kind must be "actions" or "ops"',
    exitCode: 2,
  });
}

export function compileApplyEnvelope(
  parsed: ParsedApplyEnvelope,
): Effect.Effect<CompiledApplyEnvelope, CliError, AppConfig | Payload | RefResolver> {
  return Effect.gen(function* () {
    const payloadSvc = yield* Payload;

    if (parsed.kind === 'ops') {
      const ops = yield* normalizeOps(parsed.ops);
      return {
        kind: 'ops',
        ops,
        priority: parsed.priority,
        clientId: parsed.clientId,
        idempotencyKey: parsed.idempotencyKey,
        meta: parsed.meta,
        notify: parsed.notify,
        ensureDaemon: parsed.ensureDaemon,
      };
    }

    const compiled = yield* Effect.try({
      try: () =>
        compileWritePlanV1(
          {
            version: 1,
            steps: parsed.actions.map((action) => ({
              action: action.action,
              input: action.input,
              ...(action.as ? { as: action.as } : {}),
            })),
          },
          { makeTempId },
        ),
      catch: (e) =>
        isCliError(e)
          ? e
          : new CliError({
              code: 'INVALID_PAYLOAD',
              message: String((e as any)?.message || 'Failed to compile apply actions'),
              exitCode: 2,
            }),
    });

    const resolvedOps = yield* Effect.forEach(
      compiled.ops,
      (op) =>
        resolveRefsInPayload({ opType: op.type, payload: op.payload }).pipe(
          Effect.map((payload) => ({ ...op, payload })),
        ),
      { concurrency: 1 },
    );

    const normalizedOps = yield* Effect.try({
      try: () => resolvedOps.map((op) => normalizeOp(op, payloadSvc.normalizeKeys)),
      catch: (e) =>
        isCliError(e)
          ? e
          : new CliError({
              code: 'INVALID_PAYLOAD',
              message: 'Failed to generate ops',
              exitCode: 2,
              details: { error: String((e as any)?.message || e) },
            }),
    });

    return {
      kind: 'actions',
      ops: normalizedOps,
      aliasMap: compiled.alias_map,
      priority: parsed.priority,
      clientId: parsed.clientId,
      idempotencyKey: parsed.idempotencyKey,
      meta: parsed.meta,
      notify: parsed.notify,
      ensureDaemon: parsed.ensureDaemon,
    };
  });
}
