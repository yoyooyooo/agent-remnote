import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { executeReadRemTable } from '../../../../adapters/core.js';

import { AppConfig } from '../../../../services/AppConfig.js';
import { CliError, isCliError } from '../../../../services/Errors.js';
import { Payload } from '../../../../services/Payload.js';
import { Queue } from '../../../../services/Queue.js';
import { RefResolver } from '../../../../services/RefResolver.js';
import { enqueueOps, normalizeOp } from '../../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../../_shared.js';
import { waitForTxn } from '../../../_waitTxn.js';
import { makeTempId } from '../../../_tempId.js';

import { compileTableValueOps, parseValuesArrayOnly, type TablePropertyDef } from '../../../../lib/tableValues.js';

import { normalizeRemIdInput, resolvePowerup } from '../../../_powerup.js';
import { optionToUndefined, writeCommonOptions } from '../../_shared.js';

const dispatchMode = Options.choice('dispatch-mode', ['serial', 'conflict_parallel'] as const).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);

export const writePowerupRecordAddCommand = Command.make(
  'add',
  {
    tagId: Options.text('tag-id').pipe(Options.optional, Options.map(optionToUndefined)),
    powerup: Options.text('powerup').pipe(Options.optional, Options.map(optionToUndefined)),
    parent: Options.text('parent').pipe(Options.optional, Options.map(optionToUndefined)),
    ref: Options.text('ref').pipe(Options.optional, Options.map(optionToUndefined)),
    text: Options.text('text').pipe(Options.optional, Options.map(optionToUndefined)),
    values: Options.text('values').pipe(Options.optional, Options.map(optionToUndefined)),
    extraTag: Options.text('extra-tag').pipe(Options.repeated),

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
    parent,
    ref,
    text,
    values,
    extraTag,
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
      if (parent && ref) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Choose only one of --parent or --ref',
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
      const refs = yield* RefResolver;
      const payloadSvc = yield* Payload;

      const resolved = powerup ? yield* resolvePowerup(powerup) : null;
      const tableTagId = resolved ? resolved.id : normalizeRemIdInput(tagId!);

      const resolvedRef = ref ?? 'daily:today';
      const parentId = typeof parent === 'string' ? parent : dryRun ? resolvedRef : yield* refs.resolve(resolvedRef);

      const rowClientTempId = makeTempId();

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
                  rowRemId: rowClientTempId,
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

      const extraTags = (extraTag ?? []).map((t) => normalizeRemIdInput(String(t ?? ''))).filter(Boolean);

      const opsRaw = [
        {
          type: 'table_add_row',
          payload: {
            tableTagId,
            parentId,
            ...(text !== undefined ? { text } : {}),
            ...(extraTags.length > 0 ? { extraTags } : {}),
            clientTempId: rowClientTempId,
          },
        },
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
            row_client_temp_id: rowClientTempId,
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
            op_count: ops.length,
            ops,
            meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined,
          },
          md: `- dry_run: true\n- ops: ${ops.length}\n- row_client_temp_id: ${rowClientTempId}\n`,
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
      const queue = yield* Queue;
      const created =
        waited && (waited as any).is_success === true
          ? yield* queue.inspect({ dbPath: cfg.storeDb, txnId: data.txn_id }).pipe(
              Effect.map((inspected) => {
                const idMap = Array.isArray((inspected as any)?.id_map) ? ((inspected as any).id_map as any[]) : [];
                const match = idMap.find((r) => String(r?.client_temp_id ?? '') === rowClientTempId);
                const remoteId = match?.remote_id ? String(match.remote_id) : '';
                return remoteId ? { row_rem_id: remoteId } : {};
              }),
              Effect.catchAll(() => Effect.succeed({})),
            )
          : {};

      const out = waited
        ? ({ ...data, ...waited, row_client_temp_id: rowClientTempId, ...created } as any)
        : ({ ...data, row_client_temp_id: rowClientTempId } as any);

      yield* writeSuccess({
        data: out,
        ids: [data.txn_id, ...data.op_ids, ...((created as any).row_rem_id ? [(created as any).row_rem_id] : [])],
        md: [
          `- txn_id: ${data.txn_id}`,
          `- op_ids: ${data.op_ids.length}`,
          ...((created as any).row_rem_id ? [`- row_rem_id: ${(created as any).row_rem_id}`] : []),
          `- notified: ${data.notified}`,
          `- sent: ${data.sent ?? ''}`,
          ...(waited ? [`- status: ${(waited as any).status}`, `- elapsed_ms: ${(waited as any).elapsed_ms}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
