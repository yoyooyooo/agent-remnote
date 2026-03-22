import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { invokeWave1Capability } from '../../../lib/business-semantics/modeParityRuntime.js';
import { CliError } from '../../../services/Errors.js';
import { writeFailure, writeSuccess } from '../../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));
const staleMs = Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined));

export const readSelectionRootsCommand = Command.make('roots', { stateFile, staleMs }, ({ stateFile, staleMs }) =>
  Effect.gen(function* () {
    const data: any = yield* invokeWave1Capability('selection.roots', { stateFile, staleMs });
    const ids = Array.isArray(data.ids) ? data.ids.map(String) : [];

    if (ids.length === 0) {
      return yield* Effect.fail(
        new CliError({ code: 'INVALID_ARGS', message: 'No Rem is currently selected', exitCode: 2 }),
      );
    }

    const md = ids.map((id: string) => `- ${id}`).join('\n');
    yield* writeSuccess({
      data,
      ids,
      md,
    });
  }).pipe(Effect.catchAll(writeFailure)),
);
