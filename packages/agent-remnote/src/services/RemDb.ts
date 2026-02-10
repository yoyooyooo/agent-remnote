import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import { CliError, isCliError } from './Errors.js';

import type { BackupInfo, BetterSqliteInstance, DbResolution } from '../adapters/core.js';
import { discoverBackups, withResolvedDatabase } from '../adapters/core.js';

export interface RemDbService {
  readonly withDb: <T>(
    dbPath: string | undefined,
    fn: (db: BetterSqliteInstance) => Promise<T> | T,
  ) => Effect.Effect<{ readonly result: T; readonly info: DbResolution }, CliError>;
  readonly backups: (basePath: string) => Effect.Effect<readonly BackupInfo[], CliError>;
}

export class RemDb extends Context.Tag('RemDb')<RemDb, RemDbService>() {}

export const RemDbLive = Layer.succeed(RemDb, {
  withDb: (dbPath, fn) =>
    Effect.tryPromise({
      try: async () => await withResolvedDatabase(dbPath, fn),
      catch: (error) => {
        if (isCliError(error)) return error;
        return new CliError({
          code: 'DB_UNAVAILABLE',
          message: String((error as any)?.message || error || 'RemNote DB is unavailable'),
          exitCode: 1,
          details: { db_path: dbPath },
        });
      },
    }),
  backups: (basePath) =>
    Effect.tryPromise({
      try: async () => await discoverBackups(basePath),
      catch: (error) => {
        if (isCliError(error)) return error;
        return new CliError({
          code: 'DB_UNAVAILABLE',
          message: String((error as any)?.message || error || 'Failed to read RemNote backup directory'),
          exitCode: 1,
          details: { base_path: basePath },
        });
      },
    }),
} satisfies RemDbService);
