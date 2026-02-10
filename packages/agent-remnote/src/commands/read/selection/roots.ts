import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { CliError } from '../../../services/Errors.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { loadBridgeSelectionSnapshot, requireOkRemSelection } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));
const staleMs = Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined));

export const readSelectionRootsCommand = Command.make('roots', { stateFile, staleMs }, ({ stateFile, staleMs }) =>
  Effect.gen(function* () {
    const snapshot = loadBridgeSelectionSnapshot({ stateFile, staleMs });
    const selection = yield* requireOkRemSelection(snapshot);
    const ids = selection.remIds.map(String);

    if (ids.length === 0) {
      return yield* Effect.fail(
        new CliError({ code: 'INVALID_ARGS', message: 'No Rem is currently selected', exitCode: 2, details: snapshot }),
      );
    }

    const md = ids.map((id) => `- ${id}`).join('\n');
    yield* writeSuccess({
      data: {
        selection_type: selection.selectionType,
        total_count: selection.totalCount,
        truncated: selection.truncated,
        ids,
      },
      ids,
      md,
    });
  }).pipe(Effect.catchAll(writeFailure)),
);
