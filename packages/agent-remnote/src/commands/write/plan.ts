import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { idFieldPathsForOpType } from '../../kernel/op-catalog/index.js';
import { compileWritePlanV1, parseWritePlanV1 } from '../../kernel/write-plan/index.js';
import { AppConfig } from '../../services/AppConfig.js';
import { CliError, isCliError } from '../../services/Errors.js';
import { Payload } from '../../services/Payload.js';
import { Queue } from '../../services/Queue.js';
import { RefResolver } from '../../services/RefResolver.js';
import { enqueueOps, normalizeOp } from '../_enqueue.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { waitForTxn } from '../_waitTxn.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

function readOptionalText(name: string) {
  return Options.text(name).pipe(Options.optional, Options.map(optionToUndefined));
}

const payload = Options.text('payload');

const clientId = readOptionalText('client-id');
const idempotencyKey = readOptionalText('idempotency-key');
const metaSpec = readOptionalText('meta');
const priority = Options.integer('priority').pipe(Options.optional, Options.map(optionToUndefined));
const notify = Options.boolean('no-notify').pipe(Options.map((v) => !v));
const ensureDaemon = Options.boolean('no-ensure-daemon').pipe(Options.map((v) => !v));

const wait = Options.boolean('wait');
const timeoutMs = Options.integer('timeout-ms').pipe(Options.optional, Options.map(optionToUndefined));
const pollMs = Options.integer('poll-ms').pipe(Options.optional, Options.map(optionToUndefined));

function shouldResolveRef(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  if (s.startsWith('tmp:')) return false;
  if (s.startsWith('remnote://')) return true;
  const idx = s.indexOf(':');
  if (idx <= 0) return false;
  const prefix = s.slice(0, idx).trim().toLowerCase();
  return prefix === 'id' || prefix === 'page' || prefix === 'title' || prefix === 'daily';
}

function parsePath(path: string): { readonly segments: readonly string[]; readonly array: boolean } {
  const array = path.endsWith('[]');
  const raw = array ? path.slice(0, -2) : path;
  const segments = raw.split('.').filter(Boolean);
  return { segments, array };
}

function makeUuidLike(): string {
  const g: any = globalThis as any;
  if (g.crypto && typeof g.crypto.randomUUID === 'function') return String(g.crypto.randomUUID());
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function getAt(root: any, segments: readonly string[]): any {
  let cur = root;
  for (const k of segments) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

function setAt(root: any, segments: readonly string[], value: any): void {
  let cur = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const k = segments[i]!;
    const next = cur[k];
    if (!next || typeof next !== 'object') {
      cur[k] = {};
    }
    cur = cur[k];
  }
  cur[segments[segments.length - 1]!] = value;
}

function resolveRefsInPayload(params: {
  readonly opType: string;
  readonly payload: Record<string, unknown>;
}): Effect.Effect<Record<string, unknown>, CliError, AppConfig | RefResolver> {
  return Effect.gen(function* () {
    const refs = yield* RefResolver;
    const out: Record<string, unknown> = structuredClone(params.payload);

    const idPaths = idFieldPathsForOpType(params.opType);
    for (const p of idPaths) {
      const parsed = parsePath(p);
      const current = getAt(out, parsed.segments);
      if (parsed.array) {
        if (!Array.isArray(current)) continue;
        const next: unknown[] = [];
        for (const v of current) {
          if (typeof v === 'string' && shouldResolveRef(v)) {
            next.push(yield* refs.resolve(v));
          } else {
            next.push(v);
          }
        }
        setAt(out, parsed.segments, next);
      } else {
        if (typeof current === 'string' && shouldResolveRef(current)) {
          setAt(out, parsed.segments, yield* refs.resolve(current));
        }
      }
    }

    return out;
  });
}

export const writePlanCommand = Command.make(
  'plan',
  {
    payload,
    dryRun: Options.boolean('dry-run'),

    notify,
    ensureDaemon,
    wait,
    timeoutMs,
    pollMs,

    priority,
    clientId,
    idempotencyKey,
    meta: metaSpec,
  },
  ({ payload, dryRun, notify, ensureDaemon, wait, timeoutMs, pollMs, priority, clientId, idempotencyKey, meta }) =>
    Effect.gen(function* () {
      if (!wait && (timeoutMs !== undefined || pollMs !== undefined)) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Use --wait to enable --timeout-ms/--poll-ms',
            exitCode: 2,
          }),
        );
      }

      if (dryRun && wait) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--wait is not compatible with --dry-run',
            exitCode: 2,
          }),
        );
      }

      const payloadSvc = yield* Payload;
      const raw = yield* payloadSvc.readJson(payload);
      const normalized = payloadSvc.normalizeKeys(raw);

      const plan = yield* Effect.try({
        try: () => parseWritePlanV1(normalized),
        catch: (e) =>
          isCliError(e)
            ? e
            : new CliError({
                code: 'INVALID_PAYLOAD',
                message: String((e as any)?.message || 'Invalid write plan payload'),
                exitCode: 2,
              }),
      });

      const compiled = yield* Effect.try({
        try: () =>
          compileWritePlanV1(plan, {
            makeTempId: () => `tmp:${makeUuidLike()}`,
          }),
        catch: (e) =>
          isCliError(e)
            ? e
            : new CliError({
                code: 'INVALID_PAYLOAD',
                message: String((e as any)?.message || 'Failed to compile write plan'),
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
        try: () => resolvedOps.map((o) => normalizeOp(o, payloadSvc.normalizeKeys)),
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

      const metaValue = meta ? yield* payloadSvc.readJson(meta) : undefined;
      const metaForTxn =
        metaValue && typeof metaValue === 'object'
          ? { ...(metaValue as any), write_plan: { version: 1, alias_map: compiled.alias_map } }
          : { write_plan: { version: 1, alias_map: compiled.alias_map } };

      if (dryRun) {
        yield* writeSuccess({
          data: {
            dry_run: true,
            op_count: normalizedOps.length,
            alias_map: compiled.alias_map,
            ops: resolvedOps,
            meta: payloadSvc.normalizeKeys(metaForTxn),
          },
          md: [`- dry_run: true`, `- ops: ${normalizedOps.length}`, `- aliases: ${Object.keys(compiled.alias_map).length}`].join(
            '\n',
          ),
        });
        return;
      }

      const data = yield* enqueueOps({
        ops: normalizedOps,
        priority,
        clientId,
        idempotencyKey,
        meta: metaForTxn,
        notify,
        ensureDaemon,
      });

      const waited = wait ? yield* waitForTxn({ txnId: data.txn_id, timeoutMs, pollMs }) : null;
      const out = waited ? ({ ...data, ...waited } as any) : data;

      const aliasMapForOutput =
        (data as any).deduped === true
          ? yield* Effect.gen(function* () {
              const cfg = yield* AppConfig;
              const queue = yield* Queue;
              const inspected = yield* queue.inspect({ dbPath: cfg.storeDb, txnId: data.txn_id });
              const metaJson = inspected?.txn?.meta_json;
              let stored: any = undefined;
              if (typeof metaJson === 'string' && metaJson.trim()) {
                try {
                  const parsedMeta = payloadSvc.normalizeKeys(JSON.parse(metaJson));
                  stored = (parsedMeta as any)?.write_plan?.alias_map;
                } catch {}
              }
              return stored && typeof stored === 'object' ? stored : compiled.alias_map;
            }).pipe(Effect.catchAll(() => Effect.succeed(compiled.alias_map)))
          : compiled.alias_map;

      yield* writeSuccess({
        data: {
          ...(out as any),
          op_count: normalizedOps.length,
          alias_map: aliasMapForOutput,
        },
        ids: [data.txn_id, ...data.op_ids],
        md: [
          `- txn_id: ${data.txn_id}`,
          `- op_ids: ${data.op_ids.length}`,
          `- aliases: ${Object.keys(aliasMapForOutput).length}`,
          `- notified: ${data.notified}`,
          `- sent: ${data.sent ?? ''}`,
          ...(waited ? [`- status: ${(waited as any).status}`, `- elapsed_ms: ${(waited as any).elapsed_ms}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
