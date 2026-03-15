import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { CliError, isCliError } from '../../../services/Errors.js';
import { Payload } from '../../../services/Payload.js';
import { tryParseRemnoteLink } from '../../../lib/remnote.js';
import { trimBoundaryBlankLines } from '../../../lib/text.js';
import { enqueueOps, normalizeOp } from '../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { waitForTxn } from '../../_waitTxn.js';

import { writeCommonOptions } from '../_shared.js';

function normalizeRemIdInput(raw: string): string {
  const trimmed = raw.trim();
  const link = tryParseRemnoteLink(trimmed);
  if (link?.remId) return link.remId;
  return trimmed;
}

export const writeRemSetTextCommand = Command.make(
  'set-text',
  {
    rem: Options.text('rem'),
    text: Options.text('text'),

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
  ({ rem, text, notify, ensureDaemon, wait, timeoutMs, pollMs, dryRun, priority, clientId, idempotencyKey, meta }) =>
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

      const remId = normalizeRemIdInput(rem);
      const textValue = trimBoundaryBlankLines(text);

      const op = yield* Effect.try({
        try: () => normalizeOp({ type: 'update_text', payload: { remId, text: textValue } }, payloadSvc.normalizeKeys),
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
          md: `- dry_run: true\n- op: update_text\n- rem_id: ${remId}\n`,
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
