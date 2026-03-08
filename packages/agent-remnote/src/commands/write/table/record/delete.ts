import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { executeInspectRemDoc } from '../../../../adapters/core.js';

import { AppConfig } from '../../../../services/AppConfig.js';
import { CliError, isCliError } from '../../../../services/Errors.js';
import { Payload } from '../../../../services/Payload.js';
import { enqueueOps, normalizeOp } from '../../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../../_shared.js';
import { waitForTxn } from '../../../_waitTxn.js';

import { writeCommonOptions } from '../../_shared.js';

function rowHasTag(doc: any, tagId: string): boolean {
  const tp = doc?.tp;
  if (!tp || typeof tp !== 'object' || Array.isArray(tp)) return false;
  return Object.prototype.hasOwnProperty.call(tp, tagId);
}

export const writeTableRecordDeleteCommand = Command.make(
  'delete',
  {
    tableTag: Options.text('table-tag'),
    row: Options.text('row'),

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
    row,
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

      const cfg = yield* AppConfig;
      const payloadSvc = yield* Payload;

      if (!dryRun) {
        const inspected = yield* Effect.tryPromise({
          try: async () => await executeInspectRemDoc({ id: row, dbPath: cfg.remnoteDb } as any),
          catch: (e) =>
            new CliError({
              code: 'DB_UNAVAILABLE',
              message: String((e as any)?.message || e || 'RemNote DB is unavailable'),
              exitCode: 1,
            }),
        });
        const doc = (inspected as any)?.doc;
        if (!rowHasTag(doc, tableTag)) {
          return yield* Effect.fail(
            new CliError({
              code: 'INVALID_ARGS',
              message: `Row does not belong to table tag: ${tableTag}`,
              exitCode: 2,
              details: { row_id: row, table_tag_id: tableTag },
              hint: [
                'Verify you are using the correct --table-tag',
                'Use `agent-remnote table show --id <tableTagId>` to confirm',
              ],
            }),
          );
        }
      }

      const op = yield* Effect.try({
        try: () => normalizeOp({ type: 'delete_rem', payload: { remId: row } }, payloadSvc.normalizeKeys),
        catch: (e) =>
          isCliError(e)
            ? e
            : new CliError({
                code: 'INVALID_PAYLOAD',
                message: 'Failed to generate op',
                exitCode: 2,
                details: { error: String((e as any)?.message || e) },
              }),
      });

      const metaValue = meta ? yield* payloadSvc.readJson(meta) : undefined;

      if (dryRun) {
        yield* writeSuccess({
          data: { dry_run: true, ops: [op], meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined },
          md: `- dry_run: true\n- op: delete_rem\n- rem_id: ${row}\n`,
        });
        return;
      }

      const data = yield* enqueueOps({
        ops: [op],
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
