import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { AppConfig } from '../../../services/AppConfig.js';
import { CliError } from '../../../services/Errors.js';
import { HostApiClient } from '../../../services/HostApiClient.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { loadBridgeUiContextSnapshot, requireOkUiContext } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));
const staleMs = Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined));

export const readUiContextPageCommand = Command.make('page', { stateFile, staleMs }, ({ stateFile, staleMs }) =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const hostApi = yield* HostApiClient;

    const data = cfg.apiBaseUrl
      ? yield* hostApi.uiContextPage({ baseUrl: cfg.apiBaseUrl, stateFile, staleMs })
      : yield* Effect.gen(function* () {
          const snapshot = loadBridgeUiContextSnapshot({ stateFile, staleMs });
          const ui = yield* requireOkUiContext(snapshot);
          const pageRemId = (ui.pageRemId || '').trim();
          if (!pageRemId) {
            return yield* Effect.fail(
              new CliError({
                code: 'INVALID_ARGS',
                message: 'UI context has no pageRemId (not in page view, or the SDK did not provide it)',
                exitCode: 2,
                details: snapshot,
              }),
            );
          }
          return { page_rem_id: pageRemId, ui_context: ui, snapshot };
        });

    const pageRemId = (data.page_rem_id || '').trim();
    yield* writeSuccess({
      data,
      ids: [pageRemId],
      md: `- page_rem_id: ${pageRemId}\n`,
    });
  }).pipe(Effect.catchAll(writeFailure)),
);
