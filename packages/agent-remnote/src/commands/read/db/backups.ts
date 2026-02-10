import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { executeListRemBackups } from '../../../adapters/core.js';
import { resolveUserFilePath } from '../../../lib/paths.js';

import { writeFailure, writeSuccess } from '../../_shared.js';
import { cliErrorFromUnknown } from '../../_tool.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const basePath = Options.text('base-path').pipe(Options.optional, Options.map(optionToUndefined));
const limit = Options.integer('limit').pipe(Options.withDefault(50));

export const dbBackupsCommand = Command.make('backups', { basePath, limit }, ({ basePath, limit }) =>
  Effect.tryPromise({
    try: async () =>
      await executeListRemBackups({
        basePath: basePath ? resolveUserFilePath(basePath) : undefined,
        limit: limit as any,
      } as any),
    catch: (e) => cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE' }),
  }).pipe(
    Effect.flatMap((result) => {
      const md = [
        `- base_path: ${(result as any).basePath}`,
        `- total: ${(result as any).total}`,
        ...(Array.isArray((result as any).items) ? (result as any).items.map((it: any) => `- ${it.path}`) : []),
      ].join('\n');
      return writeSuccess({ data: result, md });
    }),
    Effect.catchAll(writeFailure),
  ),
);
