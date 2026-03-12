import * as Effect from 'effect/Effect';

import { AppConfig } from '../services/AppConfig.js';
import { CliError, isCliError } from '../services/Errors.js';
import { Payload } from '../services/Payload.js';
import { Queue, type EnqueueOpInput } from '../services/Queue.js';
import { WsClient } from '../services/WsClient.js';
import type { DaemonFiles } from '../services/DaemonFiles.js';
import type { Process } from '../services/Process.js';
import type { SupervisorState } from '../services/SupervisorState.js';

import { StatusLineController } from '../runtime/status-line/StatusLineController.js';
import { canonicalizeOpType } from '../kernel/op-catalog/index.js';
import { WS_HEALTH_TIMEOUT_MS, WS_START_WAIT_DEFAULT_MS, ensureWsSupervisor } from './ws/_shared.js';
import {
  assertSupportedPropertyTypeMutation,
  assertTypedPropertyCreationSupported,
} from './write/_propertyTypeRuntimeGuard.js';

export type EnqueueAndNotifyResult = {
  readonly txn_id: string;
  readonly op_ids: readonly string[];
  readonly notified: boolean;
  readonly sent?: number;
  readonly warnings?: readonly string[];
  readonly nextActions?: readonly string[];
};

export type ParsedEnqueuePayload = {
  readonly ops: readonly any[];
  readonly priority?: number | undefined;
  readonly clientId?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly meta?: unknown;
};

export function normalizeOp(raw: any, normalizer: (u: unknown) => unknown): EnqueueOpInput {
  if (!raw || typeof raw !== 'object') {
    throw new CliError({ code: 'INVALID_PAYLOAD', message: 'op must be an object', exitCode: 2 });
  }
  const type = typeof raw.type === 'string' ? raw.type.trim() : '';
  if (!type) {
    throw new CliError({ code: 'INVALID_PAYLOAD', message: 'op.type is required and must be a string', exitCode: 2 });
  }
  const canonicalType = canonicalizeOpType(type);
  if (!canonicalType) {
    throw new CliError({ code: 'INVALID_PAYLOAD', message: 'op.type is required and must be a string', exitCode: 2 });
  }

  const payload = normalizer(raw.payload ?? {});
  assertPropertyTypeRuntimeSupported(canonicalType, payload);

  const idempotencyKey =
    typeof raw.idempotencyKey === 'string'
      ? raw.idempotencyKey
      : typeof raw.idempotency_key === 'string'
        ? raw.idempotency_key
        : undefined;

  const maxAttempts =
    typeof raw.maxAttempts === 'number'
      ? raw.maxAttempts
      : typeof raw.max_attempts === 'number'
        ? raw.max_attempts
        : undefined;

  const deliverAfterMs =
    typeof raw.deliverAfterMs === 'number'
      ? raw.deliverAfterMs
      : typeof raw.deliver_after_ms === 'number'
        ? raw.deliver_after_ms
        : undefined;

  return {
    type: canonicalType,
    payload,
    idempotencyKey,
    maxAttempts,
    deliverAfterMs,
  };
}

function assertPropertyTypeRuntimeSupported(canonicalType: string, payload: any): void {
  if (canonicalType === 'set_property_type') {
    assertSupportedPropertyTypeMutation('generic');
  }

  if (canonicalType === 'add_property') {
    assertTypedPropertyCreationSupported({
      scopeLabel: 'generic',
      type: typeof payload?.type === 'string' ? payload.type : undefined,
      hasOptions: Array.isArray(payload?.options) ? payload.options.length > 0 : false,
    });
  }
}

const OP_TYPES_REQUIRE_PARENT_ID = new Set([
  'create_rem',
  'create_portal',
  'create_single_rem_with_markdown',
  'create_tree_with_markdown',
  'create_link_rem',
  'create_table',
]);

function readParentIdFromPayload(payload: any): string | undefined {
  const v = payload?.parent_id ?? payload?.parentId;
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : undefined;
}

function assertOpsNoOrphanCreates(ops: readonly EnqueueOpInput[]): void {
  for (const op of ops) {
    if (op.type === 'table_add_row') {
      const payload: any = op.payload;
      const remId = readOptionalString(payload, ['rem_id', 'remId']);
      if (remId) continue;
      const parentId = readParentIdFromPayload(payload);
      if (parentId) continue;
      throw new CliError({
        code: 'INVALID_PAYLOAD',
        message: 'op(table_add_row) is missing parentId (creating a Rem without a parent is not allowed)',
        exitCode: 2,
        details: { op_type: op.type },
        hint: [
          'Provide payload.parentId (or parent_id) unless you are adding an existing row via payload.remId (or rem_id)',
        ],
      });
    }

    if (!OP_TYPES_REQUIRE_PARENT_ID.has(op.type)) continue;
    const parentId = readParentIdFromPayload(op.payload);
    if (parentId) continue;
    throw new CliError({
      code: 'INVALID_PAYLOAD',
      message: `op(${op.type}) is missing parentId (creating a Rem without a parent is not allowed)`,
      exitCode: 2,
      details: { op_type: op.type },
      hint: [
        'Provide payload.parentId (or parent_id) for create-type ops',
        'Example: agent-remnote rem children append --rem "<parentRemId>" --markdown "- item"',
      ],
    });
  }
}

function readOptionalString(obj: any, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function readOptionalNumber(obj: any, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

export function enqueueOps(params: {
  readonly ops: readonly EnqueueOpInput[];
  readonly priority?: number | undefined;
  readonly clientId?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly dispatchMode?: 'serial' | 'conflict_parallel' | undefined;
  readonly meta?: unknown;
  readonly notify: boolean;
  readonly ensureDaemon: boolean;
}): Effect.Effect<
  EnqueueAndNotifyResult,
  CliError,
  AppConfig | WsClient | Queue | Payload | DaemonFiles | Process | SupervisorState | StatusLineController
> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const ws = yield* WsClient;
    const queue = yield* Queue;
    const payloadSvc = yield* Payload;
    const statusLine = yield* StatusLineController;

    yield* Effect.try({
      try: () => assertOpsNoOrphanCreates(params.ops),
      catch: (e) =>
        isCliError(e)
          ? e
          : new CliError({
              code: 'INVALID_PAYLOAD',
              message: 'Op validation failed',
              exitCode: 2,
              details: { error: String((e as any)?.message || e) },
            }),
    });

    const enqueue = yield* queue.enqueue({
      dbPath: cfg.storeDb,
      ops: params.ops,
      options: {
        priority: params.priority,
        clientId: params.clientId?.trim() || undefined,
        idempotencyKey: params.idempotencyKey?.trim() || undefined,
        dispatchMode: params.dispatchMode ?? (params.ops.length > 1 ? 'conflict_parallel' : 'serial'),
        meta: params.meta ? payloadSvc.normalizeKeys(params.meta) : undefined,
      },
    });

    yield* statusLine
      .invalidate({ source: 'cli_fallback', reason: 'queue_enqueued' })
      .pipe(Effect.catchAll(() => Effect.void));

    let notified = false;
    let sent: number | undefined;
    const warnings: string[] = [];
    const nextActions: string[] = [
      `agent-remnote queue inspect --txn ${enqueue.txn_id}`,
      `agent-remnote queue progress --txn ${enqueue.txn_id}`,
    ];

    if ((enqueue as any).deduped === true) {
      warnings.push(
        'Idempotency key matched an existing transaction; reusing the existing txn (no new ops were enqueued)',
      );
    }

    if (params.notify) {
      if (params.ensureDaemon) {
        const ensured = yield* ensureWsSupervisor({ waitMs: WS_START_WAIT_DEFAULT_MS }).pipe(Effect.either);
        if (ensured._tag === 'Left') {
          warnings.push(`Failed to ensure daemon; skipping notify: ${ensured.left.message}`);
          nextActions.push('agent-remnote daemon ensure');
          nextActions.push('agent-remnote daemon status');
        }
      }

      const triggered = yield* ws
        .triggerStartSync({ url: cfg.wsUrl, timeoutMs: WS_HEALTH_TIMEOUT_MS })
        .pipe(Effect.either);
      if (triggered._tag === 'Right') {
        notified = true;
        sent = triggered.right.sent;
        if (sent === 0) {
          warnings.push('Enqueued, but no active worker/control channel was found (sent=0)');
          nextActions.push('agent-remnote daemon status');
          nextActions.push('agent-remnote daemon logs');
          if (Array.isArray((triggered.right as any).nextActions) && (triggered.right as any).nextActions.length > 0) {
            for (const a of (triggered.right as any).nextActions) warnings.push(String(a));
          } else {
            nextActions.push('agent-remnote daemon sync');
          }
        }
      } else {
        warnings.push(`Enqueued, but failed to trigger sync: ${triggered.left.message}`);
        nextActions.push('agent-remnote daemon ensure');
        nextActions.push('agent-remnote daemon status');
      }
    } else {
      nextActions.push('agent-remnote daemon sync');
    }

    return {
      ...enqueue,
      notified,
      sent,
      warnings: warnings.length > 0 ? warnings : undefined,
      nextActions: nextActions.length > 0 ? nextActions : undefined,
    };
  });
}

export function parseEnqueuePayload(raw: unknown): ParsedEnqueuePayload {
  if (Array.isArray(raw)) return { ops: raw };
  if (raw && typeof raw === 'object' && Array.isArray((raw as any).ops)) {
    const obj = raw as any;
    return {
      ops: obj.ops,
      priority: readOptionalNumber(obj, ['priority']),
      clientId: readOptionalString(obj, ['clientId', 'client_id']),
      idempotencyKey: readOptionalString(obj, ['idempotencyKey', 'idempotency_key']),
      meta: obj.meta,
    };
  }
  throw new CliError({
    code: 'INVALID_PAYLOAD',
    message: 'Invalid payload shape: expected an ops array, or { ops: [...] }',
    exitCode: 2,
  });
}

export function parseOpsPayload(raw: unknown): readonly any[] {
  return parseEnqueuePayload(raw).ops;
}

export function normalizeOps(rawOps: readonly any[]): Effect.Effect<readonly EnqueueOpInput[], CliError, Payload> {
  return Effect.gen(function* () {
    const payloadSvc = yield* Payload;
    return yield* Effect.try({
      try: () => rawOps.map((o) => normalizeOp(o, payloadSvc.normalizeKeys)),
      catch: (e) =>
        isCliError(e)
          ? e
          : new CliError({
              code: 'INVALID_PAYLOAD',
              message: 'Failed to parse payload',
              exitCode: 2,
              details: { error: String((e as any)?.message || e) },
            }),
    });
  });
}
