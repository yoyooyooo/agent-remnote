import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { CliError, isCliError } from '../../../../services/Errors.js';
import { Payload } from '../../../../services/Payload.js';
import { normalizeOp } from '../../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../../_shared.js';
import { ensureTypedPropertyCreationSupported } from '../../_propertyTypeRuntimeGuard.js';
import { dispatchOps } from '../../_dispatchOps.js';

import { optionToUndefined, writeCommonOptions } from '../../_shared.js';

export const writeTablePropertyAddCommand = Command.make(
  'add',
  {
    tableTag: Options.text('table-tag'),
    name: Options.text('name'),
    type: Options.text('type').pipe(Options.optional, Options.map(optionToUndefined)),
    options: Options.text('options').pipe(Options.optional, Options.map(optionToUndefined)),

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
    name,
    type,
    options,
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

      yield* ensureTypedPropertyCreationSupported({
        scopeLabel: 'table',
        type,
        hasOptions: typeof options === 'string' && options.trim().length > 0,
      });

      const payloadSvc = yield* Payload;

      const optionsRaw = options ? yield* payloadSvc.readJson(options) : undefined;
      const optionNames =
        optionsRaw !== undefined
          ? yield* Effect.try({
              try: () => {
                if (!Array.isArray(optionsRaw)) {
                  throw new Error('Expected options to be a string[] array');
                }
                return optionsRaw.map((v) => String(v ?? '').trim()).filter(Boolean);
              },
              catch: (e) =>
                new CliError({
                  code: 'INVALID_ARGS',
                  message: String((e as any)?.message || 'Invalid --options payload'),
                  exitCode: 2,
                  hint: ['Example: --options \'[\"Todo\",\"Doing\",\"Done\"]\''],
                }),
            })
          : undefined;

      const payload: Record<string, unknown> = { tagId: tableTag, name };
      if (type !== undefined) payload.type = type;
      if (optionNames && optionNames.length > 0) payload.options = optionNames;

      const op = yield* Effect.try({
        try: () => normalizeOp({ type: 'add_property', payload }, payloadSvc.normalizeKeys),
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
          md: `- dry_run: true\n- op: add_property\n- tag_id: ${tableTag}\n`,
        });
        return;
      }

      const out = yield* dispatchOps({
        ops: [op],
        priority,
        clientId,
        idempotencyKey,
        meta: metaValue,
        notify,
        ensureDaemon,
        wait,
        timeoutMs,
        pollMs,
      });

      yield* writeSuccess({
        data: out,
        ids: [(out as any).txn_id, ...((out as any).op_ids ?? [])],
        md: [
          `- txn_id: ${(out as any).txn_id}`,
          `- op_ids: ${Array.isArray((out as any).op_ids) ? (out as any).op_ids.length : 0}`,
          `- notified: ${(out as any).notified}`,
          `- sent: ${(out as any).sent ?? ''}`,
          ...(wait ? [`- status: ${(out as any).status}`, `- elapsed_ms: ${(out as any).elapsed_ms}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
