import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import type { BackupKind, CleanupState } from '../../internal/public.js';
import { listBackupArtifacts, openStoreDb } from '../../internal/public.js';
import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { failInRemoteMode } from '../_remoteMode.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

export const backupListCommand = Command.make(
  'list',
  {
    state: Options.choice('state', ['pending', 'orphan', 'retained', 'cleaned'] as const).pipe(Options.repeated),
    kind: Options.choice('kind', ['children_replace', 'selection_replace'] as const).pipe(Options.repeated),
    olderThanHours: Options.integer('older-than-hours').pipe(Options.optional, Options.map(optionToUndefined)),
    limit: Options.integer('limit').pipe(Options.withDefault(100)),
  },
  ({ state, kind, olderThanHours, limit }) =>
    Effect.gen(function* () {
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
      yield* failInRemoteMode({
        command: 'backup list',
        reason: 'backup governance currently reads the local store registry directly',
      });
      const cfg = yield* AppConfig;
      const db = openStoreDb(cfg.storeDb);
      try {
        const items = listBackupArtifacts(db, {
          states: state as readonly CleanupState[],
          kinds: kind as readonly BackupKind[],
          olderThanHours,
          limit,
        });
        yield* writeSuccess({
          data: { items, count: items.length },
          ids: items
            .map((item) => item.backup_rem_id)
            .filter((item): item is string => typeof item === 'string' && item.length > 0),
          md: [`- count: ${items.length}`, ...items.map((item) => `- ${item.source_op_id}: ${item.cleanup_state}`)].join('\n'),
        });
      } finally {
        db.close();
      }
    }).pipe(Effect.catchAll(writeFailure)),
).pipe(Command.withDescription('List backup artifacts from the local store registry.'));
