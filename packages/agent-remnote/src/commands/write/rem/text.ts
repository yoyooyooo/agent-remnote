import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { CliError, isCliError } from '../../../services/Errors.js';
import { Payload } from '../../../services/Payload.js';
import { trimBoundaryBlankLines } from '../../../lib/text.js';
import { normalizeOp } from '../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../_shared.js';

import { writeCommonOptions } from '../_shared.js';
import { resolveRefValue } from '../_refValue.js';
import { ensureWaitArgs, submitActionEnvelope } from './children/common.js';

export const writeRemSetTextCommand = Command.make(
  'set-text',
  {
    subject: Options.text('subject'),
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
  ({ subject, text, notify, ensureDaemon, wait, timeoutMs, pollMs, dryRun, priority, clientId, idempotencyKey, meta }) =>
    Effect.gen(function* () {
      yield* ensureWaitArgs({ wait, timeoutMs, pollMs, dryRun });

      const payloadSvc = yield* Payload;

      const remId = yield* resolveRefValue(subject);
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

      const out = yield* submitActionEnvelope({
        body: {
          version: 1,
          kind: 'ops',
          ops: [op],
          ...(priority !== undefined ? { priority } : {}),
          ...(clientId ? { client_id: clientId } : {}),
          ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
          ...(metaValue !== undefined ? { meta: metaValue } : {}),
          notify,
          ensure_daemon: ensureDaemon,
        },
        wait,
        timeoutMs,
        pollMs,
      });

      yield* writeSuccess({
        data: out,
        ids: [(out as any).txn_id, ...((out as any).op_ids ?? [])],
        md: [
          `- txn_id: ${(out as any).txn_id}`,
          `- op_ids: ${Array.isArray((out as any).op_ids) ? (out as any).op_ids.length : ''}`,
          `- notified: ${(out as any).notified}`,
          `- sent: ${(out as any).sent ?? ''}`,
          ...((out as any).status ? [`- status: ${(out as any).status}`, `- elapsed_ms: ${(out as any).elapsed_ms}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
