import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { invokeWave1Capability } from '../../../lib/business-semantics/modeParityRuntime.js';
import { compactSelectionCurrent } from '../../../lib/business-semantics/selectionResolution.js';
import { writeFailure, writeSuccess } from '../../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));
const staleMs = Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined));

export const readSelectionCurrentCommand = Command.make(
  'current',
  { stateFile, staleMs, compact: Options.boolean('compact') },
  ({ stateFile, staleMs, compact }) =>
    Effect.gen(function* () {
      const data: any = yield* invokeWave1Capability('selection.current', { stateFile, staleMs });

      const compactData = compact ? compactSelectionCurrent(data) : undefined;
      const currentId = String((compactData?.current_id ?? data?.current?.id) || '').trim();
      const currentTitle = String((compactData?.current_title ?? data?.current?.title) || '').trim();
      const pageId = String((compactData?.page_id ?? data?.page?.id) || '').trim();
      const pageTitle = String((compactData?.page_title ?? data?.page?.title) || '').trim();
      const focusId = String((compactData?.focus_id ?? data?.focus?.id) || '').trim();
      const focusTitle = String((compactData?.focus_title ?? data?.focus?.title) || '').trim();

      const md = compact
        ? [
            `- current: ${currentId ? (currentTitle ? `${currentTitle} [id=${currentId}]` : `[id=${currentId}]`) : '(none)'}`,
            `- page: ${pageId ? (pageTitle ? `${pageTitle} [id=${pageId}]` : `[id=${pageId}]`) : '(none)'}`,
            `- focus: ${focusId ? (focusTitle ? `${focusTitle} [id=${focusId}]` : `[id=${focusId}]`) : '(none)'}`,
            `- total_count: ${compactData?.total_count ?? 0}`,
            `- truncated: ${compactData?.truncated ? 'true' : 'false'}`,
          ].join('\n')
        : [
            `- selection_kind: ${data.selection_kind ?? ''}`,
            `- total_count: ${data.total_count ?? ''}`,
            `- truncated: ${data.truncated ? 'true' : 'false'}`,
            currentId ? `- current: ${currentTitle ? `${currentTitle} [id=${currentId}]` : `[id=${currentId}]`}` : '- current: (none)',
            pageId ? `- page: ${pageTitle ? `${pageTitle} [id=${pageId}]` : `[id=${pageId}]`}` : '- page: (none)',
            focusId ? `- focus: ${focusTitle ? `${focusTitle} [id=${focusId}]` : `[id=${focusId}]`}` : '- focus: (none)',
          ].join('\n');

      const ids = compact ? [currentId].filter(Boolean) : [currentId, pageId, focusId].filter(Boolean);
      yield* writeSuccess({ data: compact ? compactData : data, ids, md });
    }).pipe(Effect.catchAll(writeFailure)),
);
