import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { compileWritePlanV1, parseWritePlanV1 } from '../kernel/write-plan/index.js';
import { AppConfig } from '../services/AppConfig.js';
import { CliError, isCliError } from '../services/Errors.js';
import { Payload } from '../services/Payload.js';
import { Queue } from '../services/Queue.js';

import { enqueueOps, normalizeOp } from './_enqueue.js';
import { resolveRefsInPayload } from './_resolveRefsInPayload.js';
import { writeFailure, writeSuccess } from './_shared.js';
import { makeTempId } from './_tempId.js';
import { waitForTxn } from './_waitTxn.js';

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

type WritePlanCommandConfig = {
  readonly commandName: string;
  readonly includeOpCountInSuccessData: boolean;
  readonly aliasesBeforeNotifyInMd: boolean;
};

export function makeWritePlanCommand(config: WritePlanCommandConfig) {
  return Command.make(
    config.commandName,
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
              makeTempId,
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

        const successData: Record<string, unknown> = {
          ...(out as Record<string, unknown>),
          alias_map: aliasMapForOutput,
        };
        if (config.includeOpCountInSuccessData) {
          successData.op_count = normalizedOps.length;
        }

        const mdLines: string[] = [`- txn_id: ${data.txn_id}`, `- op_ids: ${data.op_ids.length}`];
        if (config.aliasesBeforeNotifyInMd) {
          mdLines.push(`- aliases: ${Object.keys(aliasMapForOutput).length}`);
        }
        mdLines.push(`- notified: ${data.notified}`);
        mdLines.push(`- sent: ${data.sent ?? ''}`);
        if (!config.aliasesBeforeNotifyInMd) {
          mdLines.push(`- aliases: ${Object.keys(aliasMapForOutput).length}`);
        }
        if (waited) {
          mdLines.push(`- status: ${(waited as any).status}`);
          mdLines.push(`- elapsed_ms: ${(waited as any).elapsed_ms}`);
        }

        yield* writeSuccess({
          data: successData,
          ids: [data.txn_id, ...data.op_ids],
          md: mdLines.join('\n'),
        });
      }).pipe(Effect.catchAll(writeFailure)),
  );
}
