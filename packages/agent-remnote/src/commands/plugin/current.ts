import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { collectPluginCurrentUseCase } from '../../lib/hostApiUseCases.js';
import { AppConfig } from '../../services/AppConfig.js';
import { HostApiClient } from '../../services/HostApiClient.js';
import { writeFailure, writeSuccess } from '../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));
const staleMs = Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined));
const selectionLimit = Options.integer('selection-limit').pipe(Options.withDefault(5));

function toCompact(data: any) {
  return {
    current_source: typeof data?.current?.source === 'string' ? data.current.source : 'none',
    current_id: typeof data?.current?.id === 'string' ? data.current.id : '',
    current_title: typeof data?.current?.title === 'string' ? data.current.title : undefined,
    page_id: typeof data?.page?.id === 'string' ? data.page.id : '',
    page_title: typeof data?.page?.title === 'string' ? data.page.title : undefined,
    focus_id: typeof data?.focus?.id === 'string' ? data.focus.id : '',
    focus_title: typeof data?.focus?.title === 'string' ? data.focus.title : undefined,
    selection_kind: typeof data?.selection?.kind === 'string' ? data.selection.kind : 'none',
    selection_count: typeof data?.selection?.total_count === 'number' ? data.selection.total_count : 0,
    selection_truncated: data?.selection?.truncated === true,
    selection_ids: Array.isArray(data?.selection?.ids) ? data.selection.ids.map(String) : [],
  };
}

export const pluginCurrentCommand = Command.make(
  'current',
  { stateFile, staleMs, selectionLimit, compact: Options.boolean('compact') },
  ({ stateFile, staleMs, selectionLimit, compact }) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      const hostApi = yield* HostApiClient;

      const data = cfg.apiBaseUrl
        ? yield* hostApi.pluginCurrent({ baseUrl: cfg.apiBaseUrl, stateFile, staleMs, selectionLimit })
        : yield* collectPluginCurrentUseCase({ stateFile, staleMs, selectionLimit });

      const out = compact ? toCompact(data) : data;
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
