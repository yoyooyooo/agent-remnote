import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { invokeWave1Capability } from '../../lib/business-semantics/modeParityRuntime.js';
import { compactPluginCurrent } from '../../lib/business-semantics/selectionResolution.js';
import { writeFailure, writeSuccess } from '../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));
const staleMs = Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined));
const selectionLimit = Options.integer('selection-limit').pipe(Options.withDefault(5));

export const pluginCurrentCommand = Command.make(
  'current',
  { stateFile, staleMs, selectionLimit, compact: Options.boolean('compact') },
  ({ stateFile, staleMs, selectionLimit, compact }) =>
    Effect.gen(function* () {
      const data: any = yield* invokeWave1Capability('plugin.current', { stateFile, staleMs, selectionLimit });

      const out = compact ? compactPluginCurrent(data) : data;
      const currentId = String((compact ? out.current_id : data?.current?.id) || '').trim();
      const pageId = String((compact ? out.page_id : data?.page?.id) || '').trim();
      const focusId = String((compact ? out.focus_id : data?.focus?.id) || '').trim();

      const md = compact
        ? [
            `- current: ${currentId ? `${out.current_title ?? ''} [id=${currentId}]`.trim() : '(none)'}`,
            `- page: ${pageId ? `${out.page_title ?? ''} [id=${pageId}]`.trim() : '(none)'}`,
            `- focus: ${focusId ? `${out.focus_title ?? ''} [id=${focusId}]`.trim() : '(none)'}`,
            `- selection_count: ${out.selection_count}`,
            `- selection_kind: ${out.selection_kind}`,
            `- selection_truncated: ${out.selection_truncated ? 'true' : 'false'}`,
          ].join('\n')
        : [
            `- current: ${currentId ? `${data?.current?.title ?? ''} [id=${currentId}]`.trim() : '(none)'}`,
            `- page: ${pageId ? `${data?.page?.title ?? ''} [id=${pageId}]`.trim() : '(none)'}`,
            `- focus: ${focusId ? `${data?.focus?.title ?? ''} [id=${focusId}]`.trim() : '(none)'}`,
            `- selection_count: ${data?.selection?.total_count ?? 0}`,
            `- selection_kind: ${data?.selection?.kind ?? 'none'}`,
            `- selection_truncated: ${data?.selection?.truncated ? 'true' : 'false'}`,
          ].join('\n');

      const ids = compact ? [currentId].filter(Boolean) : [currentId, pageId, focusId].filter(Boolean);
      yield* writeSuccess({ data: out, ids, md });
    }).pipe(Effect.catchAll(writeFailure)),
);
