import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { AppConfig } from '../../../services/AppConfig.js';
import { CliError, isCliError } from '../../../services/Errors.js';
import { Payload } from '../../../services/Payload.js';
import { Queue } from '../../../services/Queue.js';
import { RefResolver } from '../../../services/RefResolver.js';
import { tryParseRemnoteLink } from '../../../lib/remnote.js';
import { enqueueOps, normalizeOp } from '../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { waitForTxn } from '../../_waitTxn.js';
import { makeTempId } from '../../_tempId.js';

import { optionToUndefined, writeCommonOptions } from '../_shared.js';

function normalizeRemIdInput(raw: string): string {
  const trimmed = raw.trim();
  const link = tryParseRemnoteLink(trimmed);
  if (link?.remId) return link.remId;
  return trimmed;
}

export const writeTableCreateCommand = Command.make(
  'create',
  {
    tableTag: Options.text('table-tag'),
    parent: Options.text('parent').pipe(Options.optional, Options.map(optionToUndefined)),
    ref: Options.text('ref').pipe(Options.optional, Options.map(optionToUndefined)),
    position: Options.integer('position').pipe(Options.optional, Options.map(optionToUndefined)),
    clientTempId: Options.text('client-temp-id').pipe(Options.optional, Options.map(optionToUndefined)),

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
    parent,
    ref,
    position,
    clientTempId,
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
      if (parent && ref) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Choose only one of --parent or --ref',
            exitCode: 2,
          }),
        );
      }
      if (!parent && !ref) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'You must provide --parent or --ref',
            exitCode: 2,
          }),
        );
      }
      if (position !== undefined && (!Number.isFinite(position) || position < 0)) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--position must be a non-negative integer',
            exitCode: 2,
            details: { position },
          }),
        );
      }

      const cfg = yield* AppConfig;
      const refs = yield* RefResolver;
      const payloadSvc = yield* Payload;

      const tableTagId = normalizeRemIdInput(tableTag);
      if (!tableTagId) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Missing --table-tag',
            exitCode: 2,
          }),
        );
      }

      const resolvedRef = ref ?? '';
      const parentId =
        typeof parent === 'string'
          ? normalizeRemIdInput(parent)
          : dryRun
            ? resolvedRef
            : yield* refs.resolve(resolvedRef);

      const tableClientTempId = clientTempId ? String(clientTempId).trim() : makeTempId();

      const op = yield* Effect.try({
        try: () =>
          normalizeOp(
            {
              type: 'create_table',
              payload: {
                parentId,
                tagId: tableTagId,
                ...(position !== undefined ? { position } : {}),
                clientTempId: tableClientTempId,
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
          data: {
            dry_run: true,
            table_client_temp_id: tableClientTempId,
            ops: [op],
            meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined,
          },
          md: `- dry_run: true\n- op: create_table\n- table_client_temp_id: ${tableClientTempId}\n`,
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
      const queue = yield* Queue;

      const created =
        waited && (waited as any).is_success === true
          ? yield* queue.inspect({ dbPath: cfg.storeDb, txnId: data.txn_id }).pipe(
              Effect.map((inspected) => {
                const idMap = Array.isArray((inspected as any)?.id_map) ? ((inspected as any).id_map as any[]) : [];
                const match = idMap.find((r) => String(r?.client_temp_id ?? '') === tableClientTempId);
                const remoteId = match?.remote_id ? String(match.remote_id) : '';
                return remoteId ? { table_rem_id: remoteId } : {};
              }),
              Effect.catchAll(() => Effect.succeed({})),
            )
          : {};

      const out = waited
        ? ({ ...data, ...waited, table_client_temp_id: tableClientTempId, ...created } as any)
        : ({ ...data, table_client_temp_id: tableClientTempId } as any);

      yield* writeSuccess({
        data: out,
        ids: [data.txn_id, ...data.op_ids],
        md: [
          `- txn_id: ${data.txn_id}`,
          `- op_ids: ${data.op_ids.length}`,
          `- notified: ${data.notified}`,
          `- sent: ${data.sent ?? ''}`,
          `- table_client_temp_id: ${tableClientTempId}`,
          ...(waited ? [`- status: ${(waited as any).status}`, `- elapsed_ms: ${(waited as any).elapsed_ms}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
