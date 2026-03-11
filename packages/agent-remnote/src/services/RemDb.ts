import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import { AppConfig } from './AppConfig.js';
import { CliError, isCliError } from './Errors.js';
import { remoteModeUnsupportedError } from '../commands/_remoteMode.js';

import type { BackupInfo, BetterSqliteInstance, DbResolution } from '../adapters/core.js';
import { discoverBackups, withResolvedDatabase } from '../adapters/core.js';

export interface RemDbService {
  readonly withDb: <T>(
    dbPath: string | undefined,
    fn: (db: BetterSqliteInstance) => Promise<T> | T,
  ) => Effect.Effect<{ readonly result: T; readonly info: DbResolution }, CliError, AppConfig>;
  readonly backups: (basePath: string) => Effect.Effect<readonly BackupInfo[], CliError, AppConfig>;
}

export class RemDb extends Context.Tag('RemDb')<RemDb, RemDbService>() {}

export const RemDbLive = Layer.succeed(RemDb, {
  withDb: (dbPath, fn) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      if (cfg.apiBaseUrl) {
        return yield* Effect.fail(
          remoteModeUnsupportedError({
            command: 'local RemNote DB access',
            reason: 'this path still reads the local RemNote database directly',
            hints: [
              'Use a Host API backed read command instead.',
              'If no remote endpoint exists yet, run the command on the host.',
            ],
            apiBaseUrl: cfg.apiBaseUrl,
          }),
        );
      }

      return yield* Effect.tryPromise({
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
      });
    }),
  backups: (basePath) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      if (cfg.apiBaseUrl) {
        return yield* Effect.fail(
          remoteModeUnsupportedError({
            command: 'db backups',
            reason: 'listing backup files requires direct local filesystem access',
            hints: ['Run this command on the host.'],
            apiBaseUrl: cfg.apiBaseUrl,
          }),
        );
      }

      return yield* Effect.tryPromise({
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
      });
    }),
} satisfies RemDbService);
