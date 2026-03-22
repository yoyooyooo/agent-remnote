import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { invokeWave1Capability } from '../../../lib/business-semantics/modeParityRuntime.js';
import { writeFailure, writeSuccess } from '../../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));
const staleMs = Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined));

export const readUiContextSnapshotCommand = Command.make('snapshot', { stateFile, staleMs }, ({ stateFile, staleMs }) =>
  Effect.gen(function* () {
    const snapshot: any = yield* invokeWave1Capability('ui-context.snapshot', { stateFile, staleMs });
    const ui = snapshot.ui_context;

    const md = [
      `- status: ${snapshot.status}`,
      `- kb_id: ${ui?.kbId ?? ''}`,
      `- kb_name: ${ui?.kbName ?? ''}`,
      `- url: ${ui?.url ?? ''}`,
      `- pane_id: ${ui?.paneId ?? ''}`,
      `- page_rem_id: ${ui?.pageRemId ?? ''}`,
      `- focused_rem_id: ${ui?.focusedRemId ?? ''}`,
      `- focused_portal_id: ${ui?.focusedPortalId ?? ''}`,
      `- source: ${ui?.source ?? ''}`,
      `- clients: ${snapshot.clients}`,
      `- state_file: ${snapshot.state_file}`,
      `- updated_at: ${snapshot.updatedAt || ''}`,
      `- ui_updated_at: ${ui?.updatedAt || ''}`,
    ]
      .filter(Boolean)
      .join('\n');

    yield* writeSuccess({ data: snapshot, md });
  }).pipe(Effect.catchAll(writeFailure)),
);
