import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { executeReadRemTable } from '../../../adapters/core.js';

import { AppConfig } from '../../../services/AppConfig.js';
import { CliError, isCliError } from '../../../services/Errors.js';
import { Payload } from '../../../services/Payload.js';
import { failInRemoteMode } from '../../_remoteMode.js';
import { enqueueOps, normalizeOp } from '../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { waitForTxn } from '../../_waitTxn.js';

import { compileTableValueOps, parseValuesArrayOnly, type TablePropertyDef } from '../../../lib/tableValues.js';

import { normalizeRemIdInput, resolvePowerup } from '../../_powerup.js';
import { optionToUndefined, writeCommonOptions } from '../_shared.js';

const dispatchMode = Options.choice('dispatch-mode', ['serial', 'conflict_parallel'] as const).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);

export const writePowerupApplyCommand = Command.make(
  'apply',
  {
    rem: Options.text('rem'),
    tagId: Options.text('tag-id').pipe(Options.optional, Options.map(optionToUndefined)),
    powerup: Options.text('powerup').pipe(Options.optional, Options.map(optionToUndefined)),
    text: Options.text('text').pipe(Options.optional, Options.map(optionToUndefined)),
    values: Options.text('values').pipe(Options.optional, Options.map(optionToUndefined)),
    ensureTag: Options.boolean('no-ensure-tag').pipe(Options.map((v) => !v)),

    notify: writeCommonOptions.notify,
    ensureDaemon: writeCommonOptions.ensureDaemon,
    wait: writeCommonOptions.wait,
    timeoutMs: writeCommonOptions.timeoutMs,
    pollMs: writeCommonOptions.pollMs,
    dryRun: writeCommonOptions.dryRun,

    dispatchMode,
    priority: writeCommonOptions.priority,
    clientId: writeCommonOptions.clientId,
    idempotencyKey: writeCommonOptions.idempotencyKey,
    meta: writeCommonOptions.meta,
  },
  ({
    rem,
    tagId,
    powerup,
    text,
    values,
    ensureTag,
    notify,
    ensureDaemon,
    wait,
    timeoutMs,
    pollMs,
    dryRun,
    dispatchMode,
    priority,
    clientId,
    idempotencyKey,
    meta,
  }) =>
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
      if (!tagId && !powerup) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Provide --tag-id or --powerup',
            exitCode: 2,
            hint: ['Examples: --tag-id <id>', '--powerup Todo', '--powerup code:t', '--powerup id:<id>'],
          }),
        );
      }
      if (tagId && powerup) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Choose only one of --tag-id or --powerup',
            exitCode: 2,
          }),
        );
      }
      if (!ensureTag && text === undefined && values === undefined) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'No changes requested (provide --text and/or --values, or omit --no-ensure-tag)',
            exitCode: 2,
          }),
        );
      }

      const cfg = yield* AppConfig;
      yield* failInRemoteMode({
        command: 'powerup apply',
        reason: 'this command still reads local powerup metadata before enqueueing writes',
      });
      const payloadSvc = yield* Payload;

      const remId = normalizeRemIdInput(rem);
      const resolved = powerup ? yield* resolvePowerup(powerup) : null;
      const tableTagId = resolved ? resolved.id : normalizeRemIdInput(tagId!);

      const rawValues = values ? yield* payloadSvc.readJson(values) : undefined;
      const parsedValues =
        rawValues !== undefined
          ? yield* Effect.try({
              try: () => parseValuesArrayOnly(payloadSvc.normalizeKeys(rawValues)),
              catch: (e) =>
                new CliError({
                  code: 'INVALID_ARGS',
                  message: String((e as any)?.message || 'Invalid --values payload'),
                  exitCode: 2,
                  hint: ['Expected an array like: [{"propertyId":"<id>","value":...}]'],
                }),
            })
          : [];

      const properties: TablePropertyDef[] =
        parsedValues.length > 0
          ? yield* Effect.tryPromise({
              try: async () => {
                const table = await executeReadRemTable({
                  tagId: tableTagId,
                  dbPath: cfg.remnoteDb,
                  includeOptions: true,
                  limit: 1,
                  offset: 0,
                } as any);
                const props = Array.isArray((table as any)?.properties) ? ((table as any).properties as any[]) : [];
                return props.map((p) => ({
                  id: String(p?.id ?? ''),
                  name: String(p?.name ?? ''),
                  kind: String(p?.kind ?? ''),
                  options: Array.isArray(p?.options)
                    ? p.options.map((o: any) => ({ id: String(o?.id ?? ''), name: String(o?.name ?? '') }))
                    : undefined,
                }));
              },
              catch: (e) =>
                new CliError({
                  code: 'DB_UNAVAILABLE',
                  message: String((e as any)?.message || e || 'RemNote DB is unavailable'),
                  exitCode: 1,
                }),
            })
          : [];

      const valueOps =
        parsedValues.length > 0
          ? yield* Effect.try({
              try: () =>
                compileTableValueOps({
                  rowRemId: remId,
                  tableTagId,
                  values: parsedValues,
                  properties,
                }),
              catch: (e) =>
                new CliError({
                  code: 'INVALID_ARGS',
                  message: String((e as any)?.message || 'Invalid powerup values'),
                  exitCode: 2,
                  hint: ['Use propertyId to avoid ambiguity', 'Use optionId(s) when optionName is ambiguous'],
                }),
            })
          : [];

      const opsRaw: readonly any[] = [
        ...(ensureTag ? [{ type: 'add_tag', payload: { remId, tagId: tableTagId } }] : []),
        ...(text !== undefined ? [{ type: 'update_text', payload: { remId, text } }] : []),
        ...valueOps,
      ];

      if (opsRaw.length === 0) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'No ops generated (unexpected)',
            exitCode: 2,
          }),
        );
      }

      const ops = yield* Effect.try({
        try: () => opsRaw.map((o) => normalizeOp(o, payloadSvc.normalizeKeys)),
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

      if (dryRun) {
        yield* writeSuccess({
          data: {
            dry_run: true,
            rem_id: remId,
            tag_id: tableTagId,
            ...(resolved
              ? {
                  powerup: {
                    query: resolved.query,
                    matchedBy: resolved.matchedBy,
                    title: resolved.title,
                    code: resolved.rcrt,
                  },
                }
              : {}),
            op_count: ops.length,
            ops,
            meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined,
          },
          md: `- dry_run: true\n- ops: ${ops.length}\n- rem_id: ${remId}\n- tag_id: ${tableTagId}\n`,
        });
        return;
      }

      const data = yield* enqueueOps({
        ops,
        dispatchMode: dispatchMode ?? 'serial',
        priority,
        clientId,
        idempotencyKey,
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
