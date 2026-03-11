import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { executeInspectRemDoc } from '../../../../adapters/core.js';

import { AppConfig } from '../../../../services/AppConfig.js';
import { CliError, isCliError } from '../../../../services/Errors.js';
import { Payload } from '../../../../services/Payload.js';
import { failInRemoteMode } from '../../../_remoteMode.js';
import { enqueueOps, normalizeOp } from '../../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../../_shared.js';
import { waitForTxn } from '../../../_waitTxn.js';

import { normalizeRemIdInput, resolvePowerup } from '../../../_powerup.js';
import { optionToUndefined, writeCommonOptions } from '../../_shared.js';

function rowHasTag(doc: any, tagId: string): boolean {
  const tp = doc?.tp;
  if (!tp || typeof tp !== 'object' || Array.isArray(tp)) return false;
  return Object.prototype.hasOwnProperty.call(tp, tagId);
}

export const writePowerupRecordDeleteCommand = Command.make(
  'delete',
  {
    tagId: Options.text('tag-id').pipe(Options.optional, Options.map(optionToUndefined)),
    powerup: Options.text('powerup').pipe(Options.optional, Options.map(optionToUndefined)),
    rem: Options.text('rem'),
    validateMembership: Options.boolean('no-validate-membership').pipe(Options.map((v) => !v)),

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
    tagId,
    powerup,
    rem,
    validateMembership,
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
      if (!tagId && !powerup) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Provide --tag-id or --powerup',
            exitCode: 2,
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

      const cfg = yield* AppConfig;
      yield* failInRemoteMode({
        command: 'powerup record delete',
        reason: 'this command still validates local table membership before enqueueing writes',
      });
      const payloadSvc = yield* Payload;

      const resolved = powerup ? yield* resolvePowerup(powerup) : null;
      const tableTagId = resolved ? resolved.id : normalizeRemIdInput(tagId!);
      const remId = normalizeRemIdInput(rem);

      if (!dryRun && validateMembership) {
        const inspected = yield* Effect.tryPromise({
          try: async () => await executeInspectRemDoc({ id: remId, dbPath: cfg.remnoteDb } as any),
          catch: (e) =>
            new CliError({
              code: 'DB_UNAVAILABLE',
              message: String((e as any)?.message || e || 'RemNote DB is unavailable'),
              exitCode: 1,
            }),
        });
        const doc = (inspected as any)?.doc;
        if (!rowHasTag(doc, tableTagId)) {
          return yield* Effect.fail(
            new CliError({
              code: 'INVALID_ARGS',
              message: `Rem does not belong to powerup tag: ${tableTagId}`,
              exitCode: 2,
              details: { rem_id: remId, tag_id: tableTagId },
              hint: [
                'Verify you are using the correct --tag-id',
                'Use `agent-remnote table show --id <tagId>` to confirm',
              ],
            }),
          );
        }
      }

      const op = yield* Effect.try({
        try: () => normalizeOp({ type: 'delete_rem', payload: { remId } }, payloadSvc.normalizeKeys),
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
            ops: [op],
            meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined,
          },
          md: `- dry_run: true\n- op: delete_rem\n- rem_id: ${remId}\n`,
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
