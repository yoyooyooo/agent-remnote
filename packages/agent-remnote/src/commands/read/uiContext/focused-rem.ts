import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { CliError } from '../../../services/Errors.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { loadBridgeUiContextSnapshot, requireOkUiContext } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));
const staleMs = Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined));

export const readUiContextFocusedRemCommand = Command.make(
  'focused-rem',
  { stateFile, staleMs },
  ({ stateFile, staleMs }) =>
    Effect.gen(function* () {
      const snapshot = loadBridgeUiContextSnapshot({ stateFile, staleMs });
      const ui = yield* requireOkUiContext(snapshot);

      const focusedRemId = (ui.focusedRemId || '').trim();
      if (!focusedRemId) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'UI context has no focusedRemId (no Rem is currently focused)',
            exitCode: 2,
            details: snapshot,
          }),
        );
      }

      yield* writeSuccess({
        data: { focused_rem_id: focusedRemId, ui_context: ui, snapshot },
        ids: [focusedRemId],
        md: `- focused_rem_id: ${focusedRemId}\n`,
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
