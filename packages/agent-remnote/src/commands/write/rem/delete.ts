import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { CliError, isCliError } from '../../../services/Errors.js';
import { Payload } from '../../../services/Payload.js';
import { normalizeOp } from '../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../_shared.js';

import { writeCommonOptions } from '../_shared.js';
import { resolveRefValue } from '../_refValue.js';
import { ensureWaitArgs, submitActionEnvelope } from './children/common.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

export const writeRemDeleteCommand = Command.make(
  'delete',
  {
    subject: Options.text('subject'),
    maxDeleteSubtreeNodes: Options.integer('max-delete-subtree-nodes').pipe(
      Options.optional,
      Options.map(optionToUndefined),
    ),

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
    subject,
    maxDeleteSubtreeNodes,
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
      if (maxDeleteSubtreeNodes !== undefined && maxDeleteSubtreeNodes <= 0) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--max-delete-subtree-nodes must be a positive integer',
            exitCode: 2,
          }),
        );
      }
      yield* ensureWaitArgs({ wait, timeoutMs, pollMs, dryRun });

      const payloadSvc = yield* Payload;
      const remId = yield* resolveRefValue(subject);

      const op = yield* Effect.try({
        try: () =>
          normalizeOp(
            {
              type: 'delete_rem',
              payload: {
                remId,
                ...(maxDeleteSubtreeNodes !== undefined ? { maxDeleteSubtreeNodes } : {}),
              },
            },
            payloadSvc.normalizeKeys,
          ),
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
          md: `- dry_run: true\n- op: delete_rem\n- rem_id: ${remId}\n`,
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
      const opIds = Array.isArray((out as any).op_ids) ? (out as any).op_ids : [];

      yield* writeSuccess({
        data: out,
        ids: [(out as any).txn_id, ...opIds].filter(Boolean),
        md: [
          `- txn_id: ${(out as any).txn_id}`,
          `- op_ids: ${opIds.length}`,
          `- notified: ${(out as any).notified}`,
          `- sent: ${(out as any).sent ?? ''}`,
          ...((out as any).status ? [`- status: ${(out as any).status}`, `- elapsed_ms: ${(out as any).elapsed_ms}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
