import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { AppConfig } from '../../../services/AppConfig.js';
import { CliError } from '../../../services/Errors.js';
import { HostApiClient } from '../../../services/HostApiClient.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { loadBridgeSelectionSnapshot, requireOkRemSelection } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));
const staleMs = Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined));

export const readSelectionRootsCommand = Command.make('roots', { stateFile, staleMs }, ({ stateFile, staleMs }) =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const hostApi = yield* HostApiClient;

    const data = cfg.apiBaseUrl
      ? yield* hostApi.selectionRoots({ baseUrl: cfg.apiBaseUrl, stateFile, staleMs })
      : yield* Effect.gen(function* () {
          const snapshot = loadBridgeSelectionSnapshot({ stateFile, staleMs });
          const selection = yield* requireOkRemSelection(snapshot);
          const ids = selection.remIds.map(String);
          if (ids.length === 0) {
            return yield* Effect.fail(
              new CliError({
                code: 'INVALID_ARGS',
                message: 'No Rem is currently selected',
                exitCode: 2,
                details: snapshot,
              }),
            );
          }
          return {
            selection_type: selection.selectionType,
            total_count: selection.totalCount,
            truncated: selection.truncated,
            ids,
          };
        });
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
