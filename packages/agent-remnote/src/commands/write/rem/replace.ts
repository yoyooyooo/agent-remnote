import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import type { WriteStructureAssertion } from '../../../kernel/write-plan/model.js';

import { CliError } from '../../../services/Errors.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { repeatedSubjectOption } from '../_subjectOptions.js';
import { optionToUndefined, writeCommonOptions } from '../_shared.js';
import { resolveRefValue } from '../_refValue.js';
import {
  buildActionEnvelope,
  dryRunEnvelope,
  ensureWaitArgs,
  readMarkdownArg,
  resolveCurrentSelectionRemIds,
  submitActionEnvelope,
} from './children/common.js';

export const writeRemReplaceCommand = Command.make(
  'replace',
  {
    subject: repeatedSubjectOption,
    selection: Options.boolean('selection'),
    stateFile: Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined)),
    staleMs: Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined)),
    surface: Options.choice('surface', ['children', 'self'] as const),
    markdown: Options.text('markdown'),
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
    surface,
    markdown,
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

      const explicitIds = yield* Effect.forEach(subject, (value) => resolveRefValue(value)).pipe(
        Effect.map((ids) => ids.filter(Boolean)),
      );
      if ((explicitIds.length === 0 && !selection) || (explicitIds.length > 0 && selection)) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Provide exactly one target selector via repeated --subject or --selection',
            exitCode: 2,
          }),
        );
      }

      const target =
        explicitIds.length > 0
          ? {
              source: 'explicit' as const,
              rem_ids: Array.from(new Set(explicitIds)),
            }
          : yield* resolveCurrentSelectionRemIds({ stateFile, staleMs });

      if (surface === 'children' && target.rem_ids.length !== 1) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'rem replace --surface children requires exactly one target Rem',
            exitCode: 2,
            details: { surface, target },
          }),
        );
      }

      const assertions = assert as ReadonlyArray<WriteStructureAssertion>;
      if (surface === 'self' && assertions.includes('preserve-anchor')) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'rem replace --surface=self does not support --assert preserve-anchor',
            exitCode: 2,
          }),
        );
      }

      const markdownValue = yield* readMarkdownArg(markdown);
      const body = yield* buildActionEnvelope({
        action: 'rem.replace',
        remId: target.rem_ids[0] ?? '',
        input: {
          surface,
          rem_ids: target.rem_ids,
          markdown: markdownValue,
          ...(assertions.length > 0 ? { assertions } : {}),
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
          data: { dry_run: true, target: { source: target.source, rem_ids: target.rem_ids }, ...compiled },
          md: `- dry_run: true\n- action: rem.replace\n- surface: ${surface}\n- targets: ${target.rem_ids.length}\n`,
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
