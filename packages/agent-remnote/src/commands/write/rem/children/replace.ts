import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { CliError } from '../../../../services/Errors.js';
import { writeFailure, writeSuccess } from '../../../_shared.js';
import { writeCommonOptions } from '../../_shared.js';
import {
  buildActionEnvelope,
  dryRunEnvelope,
  ensureWaitArgs,
  extractReplaceBackupSummary,
  loadTxnDetail,
  readMarkdownArg,
  resolveCurrentSelectionRemId,
  resolveSubjectRemId,
  submitActionEnvelope,
} from './common.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

export const writeRemChildrenReplaceCommand = Command.make(
  'replace',
  {
    subject: Options.text('subject').pipe(Options.optional, Options.map(optionToUndefined)),
    selection: Options.boolean('selection'),
    stateFile: Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined)),
    staleMs: Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined)),
    markdown: Options.text('markdown'),
    backup: Options.choice('backup', ['none', 'visible'] as const).pipe(Options.withDefault('none')),
    assert: Options.choice('assert', ['single-root', 'preserve-anchor', 'no-literal-bullet'] as const).pipe(
      Options.repeated,
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
    selection,
    stateFile,
    staleMs,
    markdown,
    backup,
    assert,
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
      yield* ensureWaitArgs({ wait, timeoutMs, pollMs, dryRun });
      const hasSubject = typeof subject === 'string' && subject.trim().length > 0;
      const targetCount = Number(hasSubject) + Number(selection === true);
      if (targetCount !== 1) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Provide exactly one target via --subject or --selection',
            exitCode: 2,
          }),
        );
      }

      const target = selection
        ? yield* resolveCurrentSelectionRemId({ stateFile, staleMs })
        : {
            source: 'subject' as const,
            rem_id: yield* resolveSubjectRemId(String(subject)),
          };
      const remId = target.rem_id;
      const markdownValue = yield* readMarkdownArg(markdown);
      const body = yield* buildActionEnvelope({
        action: 'rem.children.replace',
        remId,
        input: {
          rem_id: remId,
          markdown: markdownValue,
          backup,
          ...(assert.length > 0 ? { assertions: assert } : {}),
        },
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
          data: { dry_run: true, target: { source: target.source, rem_id: remId }, ...compiled },
          md: `- dry_run: true\n- action: rem.children.replace\n- rem_id: ${remId}\n- target: ${target.source}\n`,
        });
        return;
      }

      const data = yield* submitActionEnvelope({ body, wait, timeoutMs, pollMs });
      const backupSummary =
        wait && data.status === 'succeeded' && typeof data.txn_id === 'string'
          ? extractReplaceBackupSummary(yield* loadTxnDetail({ txnId: data.txn_id }))
          : undefined;
      yield* writeSuccess({
        data: backupSummary ? { ...data, backup: backupSummary } : data,
        ids: [data.txn_id, ...(Array.isArray(data.op_ids) ? data.op_ids : [])],
        md: [
          `- txn_id: ${data.txn_id}`,
          `- op_ids: ${Array.isArray(data.op_ids) ? data.op_ids.length : ''}`,
          `- notified: ${data.notified}`,
          `- sent: ${data.sent ?? ''}`,
          ...(data.status ? [`- status: ${data.status}`, `- elapsed_ms: ${data.elapsed_ms ?? ''}`] : []),
          ...(backupSummary
            ? [
                `- backup_policy: ${backupSummary.policy}`,
                `- backup_deleted: ${backupSummary.deleted ? 'true' : 'false'}`,
                ...(backupSummary.hidden ? ['- backup_hidden: true'] : []),
                ...(backupSummary.cleanup_state ? [`- backup_cleanup_state: ${backupSummary.cleanup_state}`] : []),
              ]
            : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
