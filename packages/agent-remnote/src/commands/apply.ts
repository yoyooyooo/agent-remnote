import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { AppConfig } from '../services/AppConfig.js';
import { CliError, isCliError } from '../services/Errors.js';
import { HostApiClient } from '../services/HostApiClient.js';
import { Payload } from '../services/Payload.js';
import { executeWriteApplyUseCase } from '../lib/hostApiUseCases.js';
import { compileApplyEnvelope, parseApplyEnvelope } from './_applyEnvelope.js';
import { writeFailure, writeSuccess } from './_shared.js';
import { validateOptionMutationOps } from './write/_optionRuntimeGuard.js';

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

export const applyCommand = Command.make(
  'apply',
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
      if (dryRun && wait) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--wait is not compatible with --dry-run',
            exitCode: 2,
          }),
        );
      }

      const cfg = yield* AppConfig;
      const hostApi = yield* HostApiClient;
      const payloadSvc = yield* Payload;

      const raw = yield* payloadSvc.readJson(payload);
      const parsed = yield* Effect.try({
        try: () => parseApplyEnvelope(payloadSvc.normalizeKeys(raw)),
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
      yield* validateOptionMutationOps({ scopeLabel: 'generic', ops: compiled.ops });

      const metaFromFlag = meta ? yield* payloadSvc.readJson(meta) : undefined;
      const metaValue = metaFromFlag ?? compiled.meta;

      const resolvedPriority = priority ?? compiled.priority;
      const resolvedClientId = clientId ?? compiled.clientId;
      const resolvedIdempotencyKey = idempotencyKey ?? compiled.idempotencyKey;

      if (dryRun) {
        yield* writeSuccess({
          data: {
            dry_run: true,
            kind: compiled.kind,
            ops: compiled.ops,
            alias_map: compiled.aliasMap,
            meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined,
          },
          md: `- dry_run: true\n- kind: ${compiled.kind}\n- ops: ${compiled.ops.length}\n`,
        });
        return;
      }

      const data = cfg.apiBaseUrl
        ? yield* hostApi.writeApply({
            baseUrl: cfg.apiBaseUrl,
            body: {
              ...(raw as Record<string, unknown>),
              priority: resolvedPriority,
              clientId: resolvedClientId,
              idempotencyKey: resolvedIdempotencyKey,
              meta: metaValue,
              notify,
              ensureDaemon,
              wait,
              timeoutMs,
              pollMs,
            },
          })
        : yield* executeWriteApplyUseCase({
            raw: {
              ...(raw as Record<string, unknown>),
              priority: resolvedPriority,
              clientId: resolvedClientId,
              idempotencyKey: resolvedIdempotencyKey,
              meta: metaValue,
              notify: notify ?? compiled.notify ?? true,
              ensureDaemon: ensureDaemon ?? compiled.ensureDaemon ?? true,
            },
            wait,
            timeoutMs,
            pollMs,
          });

      const out = compiled.kind === 'actions' ? { ...data, alias_map: compiled.aliasMap } : data;

      yield* writeSuccess({
        data: out,
        ids: [data.txn_id, ...data.op_ids],
        md: `- txn_id: ${data.txn_id}\n- op_ids: ${data.op_ids.length}\n- notified: ${data.notified}\n- sent: ${data.sent ?? ''}\n`,
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
