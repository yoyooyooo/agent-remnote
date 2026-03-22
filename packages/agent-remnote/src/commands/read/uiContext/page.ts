import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { invokeWave1Capability } from '../../../lib/business-semantics/modeParityRuntime.js';
import type { BridgeUiContextSnapshot } from './_shared.js';
import { CliError } from '../../../services/Errors.js';
import { writeFailure, writeSuccess } from '../../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

type UiContextPageResult = {
  readonly page_rem_id?: string;
  readonly ui_context?: unknown;
  readonly snapshot?: BridgeUiContextSnapshot;
};

const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));
const staleMs = Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined));

export const readUiContextPageCommand = Command.make('page', { stateFile, staleMs }, ({ stateFile, staleMs }) =>
  Effect.gen(function* () {
    const data = (yield* invokeWave1Capability('ui-context.page', { stateFile, staleMs })) as UiContextPageResult;

    const pageRemId = (data.page_rem_id || '').trim();
    if (!pageRemId) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'UI context has no pageRemId (not in page view, or the SDK did not provide it)',
          exitCode: 2,
          details: data,
        }),
      );
    }
    yield* writeSuccess({
      data,
      ids: [pageRemId],
      md: `- page_rem_id: ${pageRemId}\n`,
    });
  }).pipe(Effect.catchAll(writeFailure)),
);
