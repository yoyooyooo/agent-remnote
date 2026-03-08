import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { executeReadRemTable } from '../../../../adapters/core.js';

import { AppConfig } from '../../../../services/AppConfig.js';
import { CliError, isCliError } from '../../../../services/Errors.js';
import { Payload } from '../../../../services/Payload.js';
import { Queue } from '../../../../services/Queue.js';
import { RefResolver } from '../../../../services/RefResolver.js';
import { enqueueOps, normalizeOp } from '../../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../../_shared.js';
import { waitForTxn } from '../../../_waitTxn.js';
import { makeTempId } from '../../../_tempId.js';

import { parseValuesArrayOnly, compileTableValueOps, type TablePropertyDef } from '../../../../lib/tableValues.js';

import { optionToUndefined, writeCommonOptions } from '../../_shared.js';

export const writeTableRecordAddCommand = Command.make(
  'add',
  {
    tableTag: Options.text('table-tag'),
    parent: Options.text('parent').pipe(Options.optional, Options.map(optionToUndefined)),
    ref: Options.text('ref').pipe(Options.optional, Options.map(optionToUndefined)),
    text: Options.text('text').pipe(Options.optional, Options.map(optionToUndefined)),
    values: Options.text('values').pipe(Options.optional, Options.map(optionToUndefined)),

    notify: writeCommonOptions.notify,
    ensureDaemon: writeCommonOptions.ensureDaemon,
    wait: writeCommonOptions.wait,
    timeoutMs: writeCommonOptions.timeoutMs,
    pollMs: writeCommonOptions.pollMs,
    dryRun: writeCommonOptions.dryRun,

    priority: writeCommonOptions.priority,
    clientId: writeCommonOptions.clientId,
    idempotencyKey: writeCommonOptions.idempotencyKey,
    meta: writeCommonOptions.meta,
  },
  ({
    tableTag,
    parent,
    ref,
    text,
    values,
    notify,
    ensureDaemon,
    wait,
    timeoutMs,
    pollMs,
    dryRun,
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
      if (parent && ref) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Choose only one of --parent or --ref',
            exitCode: 2,
          }),
        );
      }

      const cfg = yield* AppConfig;
      const refs = yield* RefResolver;
      const payloadSvc = yield* Payload;

      const resolvedRef = ref ?? 'daily:today';
      const parentId =
        typeof parent === 'string'
          ? parent
          : dryRun
            ? resolvedRef
            : yield* refs.resolve(resolvedRef).pipe(
                Effect.catchAll((e) =>
                  Effect.fail(
                    new CliError({
                      code: e.code === 'INVALID_ARGS' ? 'INVALID_ARGS' : e.code,
                      message:
                        resolvedRef.startsWith('daily:') && e.message.startsWith('No Rem found for ref:')
                          ? 'Daily document not found for that date. Please open it in RemNote first.'
                          : e.message,
                      exitCode: e.exitCode,
                      details: e.details,
                      hint: e.hint,
                    }),
                  ),
                ),
              );

      const rowClientTempId = makeTempId();

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
                  tagId: tableTag,
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
                  rowRemId: rowClientTempId,
                  tableTagId: tableTag,
                  values: parsedValues,
                  properties,
                }),
              catch: (e) =>
                new CliError({
                  code: 'INVALID_ARGS',
                  message: String((e as any)?.message || 'Invalid table values'),
                  exitCode: 2,
                  hint: ['Use propertyId to avoid ambiguity', 'Use optionId(s) when optionName is ambiguous'],
                }),
            })
          : [];

      const opsRaw = [
        {
          type: 'table_add_row',
          payload: {
            tableTagId: tableTag,
            parentId,
            ...(text !== undefined ? { text } : {}),
            clientTempId: rowClientTempId,
          },
        },
        ...valueOps,
      ];

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
            row_client_temp_id: rowClientTempId,
            op_count: ops.length,
            ops,
            meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined,
          },
          md: `- dry_run: true\n- ops: ${ops.length}\n- row_client_temp_id: ${rowClientTempId}\n`,
        });
        return;
      }

      const data = yield* enqueueOps({
        ops,
        priority,
        clientId,
        idempotencyKey,
        meta: metaValue,
        notify,
        ensureDaemon,
      });

      const waited = wait ? yield* waitForTxn({ txnId: data.txn_id, timeoutMs, pollMs }) : null;
      const queue = yield* Queue;
      const created =
        waited && (waited as any).is_success === true
          ? yield* queue.inspect({ dbPath: cfg.storeDb, txnId: data.txn_id }).pipe(
              Effect.map((inspected) => {
                const idMap = Array.isArray((inspected as any)?.id_map) ? ((inspected as any).id_map as any[]) : [];
                const match = idMap.find((r) => String(r?.client_temp_id ?? '') === rowClientTempId);
                const remoteId = match?.remote_id ? String(match.remote_id) : '';
                return remoteId ? { row_rem_id: remoteId } : {};
              }),
              Effect.catchAll(() => Effect.succeed({})),
            )
          : {};
      const out = waited
        ? ({ ...data, ...waited, row_client_temp_id: rowClientTempId, ...created } as any)
        : ({ ...data, row_client_temp_id: rowClientTempId } as any);

      yield* writeSuccess({
        data: out,
        ids: [data.txn_id, ...data.op_ids],
        md: [
          `- txn_id: ${data.txn_id}`,
          `- op_ids: ${data.op_ids.length}`,
          `- notified: ${data.notified}`,
          `- sent: ${data.sent ?? ''}`,
          `- row_client_temp_id: ${rowClientTempId}`,
          ...(waited ? [`- status: ${(waited as any).status}`, `- elapsed_ms: ${(waited as any).elapsed_ms}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
