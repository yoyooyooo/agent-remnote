import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { executeGetRemConnections } from '../../adapters/core.js';

import { AppConfig } from '../../services/AppConfig.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { cliErrorFromUnknown } from '../_tool.js';

export const readConnectionsCommand = Command.make('connections', { id: Options.text('id') }, ({ id }) =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const payload = yield* Effect.tryPromise({
      try: async () => await executeGetRemConnections({ id, dbPath: cfg.remnoteDb } as any),
      catch: (e) => cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE' }),
    });

    yield* writeSuccess({ data: payload, md: (payload as any).markdown ?? '' });
  }).pipe(Effect.catchAll(writeFailure)),
);
