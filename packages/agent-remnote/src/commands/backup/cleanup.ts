import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { AppConfig } from '../../services/AppConfig.js';
import { Payload } from '../../services/Payload.js';
import type { BackupKind, CleanupState } from '../../internal/public.js';
import { listBackupArtifacts, openStoreDb, updateBackupArtifactsCleanupState } from '../../internal/public.js';
import { enqueueOps, normalizeOp } from '../_enqueue.js';
import { failInRemoteMode } from '../_remoteMode.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { waitForTxn } from '../_waitTxn.js';
import { CliError } from '../../services/Errors.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

export const backupCleanupCommand = Command.make(
  'cleanup',
  {
    apply: Options.boolean('apply'),
    backupRemId: Options.text('backup-rem-id').pipe(Options.optional, Options.map(optionToUndefined)),
    maxDeleteSubtreeNodes: Options.integer('max-delete-subtree-nodes').pipe(
      Options.optional,
      Options.map(optionToUndefined),
    ),
    state: Options.choice('state', ['pending', 'orphan', 'retained', 'cleaned'] as const).pipe(Options.repeated),
    kind: Options.choice('kind', ['children_replace', 'selection_replace'] as const).pipe(Options.repeated),
    olderThanHours: Options.integer('older-than-hours').pipe(Options.optional, Options.map(optionToUndefined)),
    limit: Options.integer('limit').pipe(Options.withDefault(100)),
    wait: Options.boolean('wait'),
    timeoutMs: Options.integer('timeout-ms').pipe(Options.optional, Options.map(optionToUndefined)),
    pollMs: Options.integer('poll-ms').pipe(Options.optional, Options.map(optionToUndefined)),
    notify: Options.boolean('no-notify').pipe(Options.map((value) => !value)),
    ensureDaemon: Options.boolean('no-ensure-daemon').pipe(Options.map((value) => !value)),
  },
  ({
    apply,
    backupRemId,
    maxDeleteSubtreeNodes,
    state,
    kind,
    olderThanHours,
    limit,
    wait,
    timeoutMs,
    pollMs,
    notify,
    ensureDaemon,
  }) =>
    Effect.gen(function* () {
      if (maxDeleteSubtreeNodes !== undefined && maxDeleteSubtreeNodes <= 0) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--max-delete-subtree-nodes must be >= 1',
            exitCode: 2,
          }),
        );
      }
      if (olderThanHours !== undefined && olderThanHours < 0) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--older-than-hours must be a non-negative integer',
            exitCode: 2,
          }),
        );
      }
      if (limit < 1) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--limit must be >= 1',
            exitCode: 2,
          }),
        );
      }
      if (!wait && (timeoutMs !== undefined || pollMs !== undefined)) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Use --wait to enable --timeout-ms/--poll-ms',
            exitCode: 2,
          }),
        );
      }
      if (!apply && wait) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--wait requires --apply',
            exitCode: 2,
          }),
        );
      }

      yield* failInRemoteMode({
        command: 'backup cleanup',
        reason: 'backup governance currently reads and updates the local store registry directly',
      });

      const cfg = yield* AppConfig;
      const payloadSvc = yield* Payload;
      const db = openStoreDb(cfg.storeDb);
      try {
        const states =
          state.length > 0 ? (state as readonly CleanupState[]) : backupRemId ? ([] as const) : (['orphan'] as const);
        const items = listBackupArtifacts(db, {
          states,
          kinds: kind as readonly BackupKind[],
          backupRemId,
          olderThanHours,
          limit,
        }).filter((item) => typeof item.backup_rem_id === 'string' && item.backup_rem_id.length > 0);

        if (backupRemId && items.length === 0) {
          return yield* Effect.fail(
            new CliError({
              code: 'INVALID_ARGS',
              message: `No backup artifact found for --backup-rem-id ${backupRemId}`,
              exitCode: 2,
            }),
          );
        }

        if (!apply) {
          yield* writeSuccess({
            data: { dry_run: true, items, count: items.length },
            ids: items.map((item) => item.backup_rem_id!).filter(Boolean),
            md: [`- dry_run: true`, `- count: ${items.length}`].join('\n'),
          });
          return;
        }

        const ops = items.map((item) =>
          normalizeOp(
            {
              type: 'delete_backup_artifact',
              payload: {
                rem_id: item.backup_rem_id,
                ...(maxDeleteSubtreeNodes !== undefined ? { max_delete_subtree_nodes: maxDeleteSubtreeNodes } : {}),
              },
            },
            payloadSvc.normalizeKeys,
          ),
        );

        const data =
          ops.length > 0
            ? yield* enqueueOps({
                ops,
                notify,
                ensureDaemon,
              })
            : { txn_id: '', op_ids: [], notified: false };

        updateBackupArtifactsCleanupState(db, {
          sourceOpIds: items.map((item) => item.source_op_id),
          cleanupState: wait && ops.length === 0 ? 'cleaned' : 'pending',
        });

        const waited =
          wait && data.txn_id
            ? yield* waitForTxn({ txnId: data.txn_id, timeoutMs, pollMs })
            : null;

        if (waited?.status === 'succeeded') {
          updateBackupArtifactsCleanupState(db, {
            sourceOpIds: items.map((item) => item.source_op_id),
            cleanupState: 'cleaned',
          });
        }

        yield* writeSuccess({
          data: {
            dry_run: false,
            items,
            count: items.length,
            ...(data.txn_id ? data : {}),
            ...(waited ? waited : {}),
          },
          ids: [data.txn_id, ...data.op_ids].filter(Boolean),
          md: [
            `- dry_run: false`,
            `- count: ${items.length}`,
            ...(data.txn_id ? [`- txn_id: ${data.txn_id}`] : []),
            ...(waited ? [`- status: ${waited.status}`, `- elapsed_ms: ${waited.elapsed_ms ?? ''}`] : []),
          ].join('\n'),
        });
      } finally {
        db.close();
      }
    }).pipe(Effect.catchAll(writeFailure)),
).pipe(
  Command.withDescription('Dry-run by default. Use --apply to enqueue delete_backup_artifact cleanup for backup artifacts.'),
);
