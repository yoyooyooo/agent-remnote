import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { executeListTodos } from '../../../../adapters/core.js';

import { AppConfig } from '../../../../services/AppConfig.js';
import { CliError, isCliError } from '../../../../services/Errors.js';
import { Payload } from '../../../../services/Payload.js';
import { failInRemoteMode } from '../../../_remoteMode.js';
import { enqueueOps, normalizeOp } from '../../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../../_shared.js';
import { waitForTxn } from '../../../_waitTxn.js';

import { normalizeRemIdInput } from '../../../_powerup.js';
import { optionToUndefined, writeCommonOptions } from '../../_shared.js';

function pickTodoTagId(schemas: readonly any[], tagId?: string): string | null {
  const mapped = schemas
    .map((s: any) => ({ tagId: String(s?.tagId ?? ''), tagName: String(s?.tagName ?? '') }))
    .filter((s) => s.tagId);
  if (tagId) return mapped.find((s) => s.tagId === tagId)?.tagId ?? null;
  const byName = mapped.find((s) => s.tagName.trim().toLowerCase() === 'todo');
  return byName?.tagId ?? mapped[0]?.tagId ?? null;
}

export const writePowerupTodoRemoveCommand = Command.make(
  'remove',
  {
    rem: Options.text('rem'),
    tagId: Options.text('tag-id').pipe(Options.optional, Options.map(optionToUndefined)),
    removeProperties: Options.boolean('remove-properties').pipe(Options.optional, Options.map(optionToUndefined)),

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
    rem,
    tagId,
    removeProperties,
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

      const cfg = yield* AppConfig;
      yield* failInRemoteMode({
        command: 'todo remove',
        reason: 'this command still reads local todo schema metadata before enqueueing writes',
      });
      const payloadSvc = yield* Payload;

      const remId = normalizeRemIdInput(rem);
      const normalizedTagId = tagId ? normalizeRemIdInput(tagId) : undefined;

      const discovered = yield* Effect.tryPromise({
        try: async () =>
          await executeListTodos({
            dbPath: cfg.remnoteDb,
            status: 'all',
            ...(normalizedTagId ? { tagIds: [normalizedTagId] } : {}),
            limit: 1,
            offset: 0,
          } as any),
        catch: (e) =>
          new CliError({
            code: 'DB_UNAVAILABLE',
            message: String((e as any)?.message || e || 'RemNote DB is unavailable'),
            exitCode: 1,
          }),
      });

      const schemas = Array.isArray((discovered as any)?.usedSchemas) ? ((discovered as any).usedSchemas as any[]) : [];
      const todoTagId = pickTodoTagId(schemas, normalizedTagId);
      if (!todoTagId) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Todo powerup tag not found. Provide --tag-id to specify it explicitly.',
            exitCode: 2,
          }),
        );
      }

      const payload: Record<string, unknown> = { remId, tagId: todoTagId };
      if (removeProperties !== undefined) payload.removeProperties = removeProperties;

      const op = yield* Effect.try({
        try: () => normalizeOp({ type: 'remove_tag', payload }, payloadSvc.normalizeKeys),
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
            rem_id: remId,
            tag_id: todoTagId,
            ops: [op],
            meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined,
          },
          md: `- dry_run: true\n- op: remove_tag\n- rem_id: ${remId}\n- tag_id: ${todoTagId}\n`,
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
