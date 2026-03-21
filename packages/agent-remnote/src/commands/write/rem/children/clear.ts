import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { writeFailure, writeSuccess } from '../../../_shared.js';
import { writeCommonOptions } from '../../_shared.js';
import { buildActionEnvelope, dryRunEnvelope, ensureWaitArgs, resolveSubjectRemId, submitActionEnvelope } from './common.js';

export const writeRemChildrenClearCommand = Command.make(
  'clear',
  {
    subject: Options.text('subject'),

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
  ({ subject, notify, ensureDaemon, wait, timeoutMs, pollMs, dryRun, priority, clientId, idempotencyKey, meta }) =>
    Effect.gen(function* () {
      yield* ensureWaitArgs({ wait, timeoutMs, pollMs, dryRun });
      const remId = yield* resolveSubjectRemId(subject);
      const body = yield* buildActionEnvelope({
        action: 'rem.children.clear',
        remId,
        priority,
        clientId,
        idempotencyKey,
        metaSpec: meta,
        notify,
        ensureDaemon,
      });

      if (dryRun) {
        const compiled = yield* dryRunEnvelope(body);
        yield* writeSuccess({
          data: { dry_run: true, ...compiled },
          md: `- dry_run: true\n- action: rem.children.clear\n- rem_id: ${remId}\n`,
        });
        return;
      }

      const data = yield* submitActionEnvelope({ body, wait, timeoutMs, pollMs });
      yield* writeSuccess({
        data,
        ids: [data.txn_id, ...(Array.isArray(data.op_ids) ? data.op_ids : [])],
        md: [
          `- txn_id: ${data.txn_id}`,
          `- op_ids: ${Array.isArray(data.op_ids) ? data.op_ids.length : ''}`,
          `- notified: ${data.notified}`,
          `- sent: ${data.sent ?? ''}`,
          ...(data.status ? [`- status: ${data.status}`, `- elapsed_ms: ${data.elapsed_ms ?? ''}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
