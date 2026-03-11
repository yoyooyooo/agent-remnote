import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { writeFailure, writeSuccess } from '../../../_shared.js';
import { writeCommonOptions } from '../../_shared.js';
import {
  buildActionEnvelope,
  dryRunEnvelope,
  ensureWaitArgs,
  normalizeRemIdInput,
  readMarkdownArg,
  submitActionEnvelope,
} from './common.js';

export const writeRemChildrenAppendCommand = Command.make(
  'append',
  {
    rem: Options.text('rem'),
    markdown: Options.text('markdown'),

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
  ({ rem, markdown, notify, ensureDaemon, wait, timeoutMs, pollMs, dryRun, priority, clientId, idempotencyKey, meta }) =>
    Effect.gen(function* () {
      yield* ensureWaitArgs({ wait, timeoutMs, pollMs, dryRun });
      const remId = normalizeRemIdInput(rem);
      const markdownValue = yield* readMarkdownArg(markdown);
      const body = yield* buildActionEnvelope({
        action: 'rem.children.append',
        remId,
        markdown: markdownValue,
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
          md: `- dry_run: true\n- action: rem.children.append\n- rem_id: ${remId}\n`,
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
