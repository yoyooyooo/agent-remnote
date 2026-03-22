import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { invokeWave1Capability } from '../../../lib/business-semantics/modeParityRuntime.js';
import type { BridgeSelectionSnapshot } from './_shared.js';
import { writeFailure, writeSuccess } from '../../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));
const staleMs = Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined));

export const readSelectionSnapshotCommand = Command.make('snapshot', { stateFile, staleMs }, ({ stateFile, staleMs }) =>
  Effect.gen(function* () {
    const snapshot = (yield* invokeWave1Capability('selection.snapshot', {
      stateFile,
      staleMs,
    })) as BridgeSelectionSnapshot;
    const selection = snapshot.selection;
    const kind = selection?.kind ?? 'none';
    const selectionType = selection && 'selectionType' in selection ? (selection.selectionType ?? '') : '';

    let selected = 0;
    let roots = 0;
    let truncated = false;
    let textRemId = '';
    let textRange = '';
    let textIsReverse = false;

    if (selection?.kind === 'rem') {
      selected = selection.totalCount;
      roots = selection.remIds.length;
      truncated = selection.truncated;
    } else if (selection?.kind === 'text') {
      selected = 1;
      textRemId = selection.remId;
      textRange = `${selection.range.start}-${selection.range.end}`;
      textIsReverse = selection.isReverse;
    }

    const md = [
      `- status: ${snapshot.status}`,
      `- kind: ${kind}`,
      `- selected: ${selected}`,
      `- roots: ${roots}`,
      selectionType ? `- selection_type: ${selectionType}` : '',
      kind === 'rem' ? `- truncated: ${truncated ? 'true' : 'false'}` : '',
      kind === 'text' ? `- rem_id: ${textRemId}` : '',
      kind === 'text' ? `- range: ${textRange}` : '',
      kind === 'text' ? `- is_reverse: ${textIsReverse ? 'true' : 'false'}` : '',
      `- clients: ${snapshot.clients}`,
      `- state_file: ${snapshot.state_file}`,
      `- updated_at: ${snapshot.updatedAt || ''}`,
      `- selection_updated_at: ${selection?.updatedAt || ''}`,
    ]
      .filter(Boolean)
      .join('\n');

    yield* writeSuccess({ data: snapshot, md });
  }).pipe(Effect.catchAll(writeFailure)),
);
