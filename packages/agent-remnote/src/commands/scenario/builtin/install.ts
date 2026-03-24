import * as Args from '@effect/cli/Args';
import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { installBuiltinScenarioPackages } from '../../../lib/scenario-store/index.js';
import { CliError, isCliError } from '../../../services/Errors.js';
import { writeFailure, writeSuccess } from '../../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const ids = Args.text({ name: 'id' }).pipe(Args.repeated);
const all = Options.boolean('all');
const dir = Options.text('dir').pipe(Options.optional, Options.map(optionToUndefined));
const ifMissing = Options.boolean('if-missing');

export const scenarioBuiltinInstallCommand = Command.make(
  'install',
  { id: ids, all, dir, ifMissing },
  ({ id, all, dir, ifMissing }) =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () =>
          installBuiltinScenarioPackages({
            ids: id,
            all,
            installDir: dir,
            ifMissing,
          }),
        catch: (error) =>
          isCliError(error)
            ? error
            : new CliError({
                code: 'INTERNAL',
                message: String((error as any)?.message || error || 'scenario builtin install failed'),
                exitCode: 1,
              }),
      });

      const md = [
        `- install_dir: ${result.installDir}`,
        `- requested: ${result.requestedIds.join(', ')}`,
        `- installed: ${result.installed.length}`,
        `- skipped: ${result.skipped.length}`,
      ].join('\n');

      yield* writeSuccess({
        data: {
          install_dir: result.installDir,
          requested_ids: result.requestedIds,
          installed: result.installed,
          skipped: result.skipped,
        },
        md,
      });
    }).pipe(Effect.catchAll(writeFailure)),
).pipe(Command.withDescription('Install builtin scenario packages into the user scenario directory.'));
