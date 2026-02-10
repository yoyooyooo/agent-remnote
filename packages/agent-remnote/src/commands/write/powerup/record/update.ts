import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { executeInspectRemDoc, executeReadRemTable } from '../../../../adapters/core.js';

import { AppConfig } from '../../../../services/AppConfig.js';
import { CliError, isCliError } from '../../../../services/Errors.js';
import { Payload } from '../../../../services/Payload.js';
import { enqueueOps, normalizeOp } from '../../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../../_shared.js';
import { waitForTxn } from '../../../_waitTxn.js';

import { compileTableValueOps, parseValuesArrayOnly, type TablePropertyDef } from '../../../../lib/tableValues.js';

import { normalizeRemIdInput, resolvePowerup } from '../../../_powerup.js';
import { optionToUndefined, writeCommonOptions } from '../../_shared.js';

const dispatchMode = Options.choice('dispatch-mode', ['serial', 'conflict_parallel'] as const).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);

function rowHasTag(doc: any, tagId: string): boolean {
  const tp = doc?.tp;
  if (!tp || typeof tp !== 'object' || Array.isArray(tp)) return false;
  return Object.prototype.hasOwnProperty.call(tp, tagId);
}

export const writePowerupRecordUpdateCommand = Command.make(
  'update',
  {
    tagId: Options.text('tag-id').pipe(Options.optional, Options.map(optionToUndefined)),
    powerup: Options.text('powerup').pipe(Options.optional, Options.map(optionToUndefined)),
    rem: Options.text('rem'),
    text: Options.text('text').pipe(Options.optional, Options.map(optionToUndefined)),
    values: Options.text('values').pipe(Options.optional, Options.map(optionToUndefined)),
    validateMembership: Options.boolean('no-validate-membership').pipe(Options.map((v) => !v)),

    notify: writeCommonOptions.notify,
    ensureDaemon: writeCommonOptions.ensureDaemon,
    wait: writeCommonOptions.wait,
    timeoutMs: writeCommonOptions.timeoutMs,
    pollMs: writeCommonOptions.pollMs,
    dryRun: writeCommonOptions.dryRun,

    dispatchMode,
    priority: writeCommonOptions.priority,
    clientId: writeCommonOptions.clientId,
    idempotencyKey: writeCommonOptions.idempotencyKey,
    meta: writeCommonOptions.meta,
  },
  ({
    tagId,
    powerup,
    rem,
    text,
    values,
    validateMembership,
    notify,
    ensureDaemon,
    wait,
    timeoutMs,
    pollMs,
    dryRun,
    dispatchMode,
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
      if (text === undefined && values === undefined) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'You must provide at least one of --text or --values',
            exitCode: 2,
          }),
        );
      }

      const cfg = yield* AppConfig;
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
              hint: ['Verify you are using the correct --tag-id', 'Use `agent-remnote table show --id <tagId>` to confirm'],
            }),
          );
        }
      }

      const rawValues = values ? yield* payloadSvc.readJson(values) : undefined;
      const parsedValues =
        rawValues !== undefined
          ? yield* Effect.try({
              try: () => parseValuesArrayOnly(payloadSvc.normalizeKeys(rawValues)),
              catch: (e) =>
                new CliError({
                  code: 'INVALID_ARGS',
                  message: String((e as any)?.message || 'Invalid --values payload'),
                  exitCode: 2,
                  hint: ['Expected an array like: [{"propertyId":"<id>","value":...}]'],
                }),
            })
          : [];

      const properties: TablePropertyDef[] =
        parsedValues.length > 0
          ? yield* Effect.tryPromise({
              try: async () => {
                const table = await executeReadRemTable({
                  tagId: tableTagId,
                  dbPath: cfg.remnoteDb,
                  includeOptions: true,
                  limit: 1,
                  offset: 0,
                } as any);
                const props = Array.isArray((table as any)?.properties) ? ((table as any).properties as any[]) : [];
                return props.map((p) => ({
                  id: String(p?.id ?? ''),
                  name: String(p?.name ?? ''),
                  kind: String(p?.kind ?? ''),
                  options: Array.isArray(p?.options)
                    ? p.options.map((o: any) => ({ id: String(o?.id ?? ''), name: String(o?.name ?? '') }))
                    : undefined,
                }));
              },
              catch: (e) =>
                new CliError({
                  code: 'DB_UNAVAILABLE',
                  message: String((e as any)?.message || e || 'RemNote DB is unavailable'),
                  exitCode: 1,
                }),
            })
          : [];

      const valueOps =
        parsedValues.length > 0
          ? yield* Effect.try({
              try: () =>
                compileTableValueOps({
                  rowRemId: remId,
                  tableTagId,
                  values: parsedValues,
                  properties,
                }),
              catch: (e) =>
                new CliError({
                  code: 'INVALID_ARGS',
                  message: String((e as any)?.message || 'Invalid powerup values'),
                  exitCode: 2,
                  hint: ['Use propertyId to avoid ambiguity', 'Use optionId(s) when optionName is ambiguous'],
                }),
            })
          : [];

      const opsRaw: readonly any[] = [
        ...(text !== undefined ? [{ type: 'update_text', payload: { remId, text } }] : []),
        ...valueOps,
      ];

      const ops = yield* Effect.try({
        try: () => opsRaw.map((o) => normalizeOp(o, payloadSvc.normalizeKeys)),
        catch: (e) =>
          isCliError(e)
            ? e
            : new CliError({
                code: 'INVALID_PAYLOAD',
                message: 'Failed to generate ops',
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
            ...(resolved ? { powerup: { query: resolved.query, matchedBy: resolved.matchedBy, title: resolved.title, code: resolved.rcrt } } : {}),
            op_count: ops.length,
            ops,
            meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined,
          },
          md: `- dry_run: true\n- ops: ${ops.length}\n- rem_id: ${remId}\n`,
        });
        return;
      }

      const data = yield* enqueueOps({
        ops,
        dispatchMode: dispatchMode ?? 'serial',
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
