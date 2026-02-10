import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { CliError, isCliError } from '../../services/Errors.js';
import { Payload } from '../../services/Payload.js';
import { waitForTxn } from '../_waitTxn.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { enqueueOps, normalizeOps, parseEnqueuePayload } from '../_enqueue.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

function readOptionalText(name: string) {
  return Options.text(name).pipe(Options.optional, Options.map(optionToUndefined));
}

const payloadSpec = Options.text('payload');
const metaSpec = readOptionalText('meta');

const clientId = readOptionalText('client-id');
const idempotencyKey = readOptionalText('idempotency-key');

const priority = Options.integer('priority').pipe(Options.optional, Options.map(optionToUndefined));
const notify = Options.boolean('no-notify').pipe(Options.map((v) => !v));
const ensureDaemon = Options.boolean('no-ensure-daemon').pipe(Options.map((v) => !v));
const wait = Options.boolean('wait');
const timeoutMs = Options.integer('timeout-ms').pipe(Options.optional, Options.map(optionToUndefined));
const pollMs = Options.integer('poll-ms').pipe(Options.optional, Options.map(optionToUndefined));

export const writeOpsCommand = Command.make(
  'ops',
  {
    payload: payloadSpec,
    notify,
    ensureDaemon,
    wait,
    timeoutMs,
    pollMs,
    dryRun: Options.boolean('dry-run'),

    priority,
    clientId,
    idempotencyKey,
    meta: metaSpec,
  },
  ({ payload, notify, ensureDaemon, wait, timeoutMs, pollMs, dryRun, priority, clientId, idempotencyKey, meta }) =>
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

      const payloadSvc = yield* Payload;

      const raw = yield* payloadSvc.readJson(payload);

      const parsed = yield* Effect.try({
        try: () => parseEnqueuePayload(raw),
        catch: (e) =>
          isCliError(e)
            ? e
            : new CliError({
                code: 'INVALID_PAYLOAD',
                message: 'Invalid payload shape: expected an ops array, or { ops: [...] }',
                exitCode: 2,
              }),
      });

      const rawOps = parsed.ops;
      if (rawOps.length === 0) {
        return yield* Effect.fail(new CliError({ code: 'INVALID_PAYLOAD', message: 'ops must not be empty', exitCode: 2 }));
      }
      if (rawOps.length > 500) {
        return yield* Effect.fail(
          new CliError({
            code: 'PAYLOAD_TOO_LARGE',
            message: `Too many ops (${rawOps.length}); split the request and try again`,
            exitCode: 2,
            details: { ops: rawOps.length, max_ops: 500 },
          }),
        );
      }

      const ops = yield* normalizeOps(rawOps);

      const metaFromFlag = meta ? yield* payloadSvc.readJson(meta) : undefined;
      const metaValue = metaFromFlag ?? parsed.meta;

      const resolvedPriority = priority ?? parsed.priority;
      const resolvedClientId = clientId ?? parsed.clientId;
      const resolvedIdempotencyKey = idempotencyKey ?? parsed.idempotencyKey;

      if (dryRun) {
        if (wait) {
          return yield* Effect.fail(
            new CliError({
              code: 'INVALID_ARGS',
              message: '--wait is not compatible with --dry-run',
              exitCode: 2,
            }),
          );
        }
        yield* writeSuccess({
          data: { dry_run: true, ops, meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined },
          md: `- dry_run: true\n- ops: ${ops.length}\n`,
        });
        return;
      }

      const data = yield* enqueueOps({
        ops,
        priority: resolvedPriority,
        clientId: resolvedClientId,
        idempotencyKey: resolvedIdempotencyKey,
        meta: metaValue,
        notify,
        ensureDaemon,
      });

      const waited = wait ? yield* waitForTxn({ txnId: data.txn_id, timeoutMs, pollMs }) : null;
      const out = waited ? ({ ...data, ...waited } as any) : data;

      yield* writeSuccess({
        data: out,
        ids: [data.txn_id, ...data.op_ids],
        md: [
          `- txn_id: ${data.txn_id}`,
          `- op_ids: ${data.op_ids.length}`,
          `- notified: ${data.notified}`,
          `- sent: ${data.sent ?? ''}`,
          ...(waited ? [`- status: ${(waited as any).status}`, `- elapsed_ms: ${(waited as any).elapsed_ms}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
