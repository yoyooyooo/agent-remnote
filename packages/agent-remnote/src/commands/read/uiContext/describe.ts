import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { invokeWave1Capability } from '../../../lib/business-semantics/modeParityRuntime.js';
import type { BridgeSelectionSnapshot } from '../selection/_shared.js';
import type { BridgeUiContextSnapshot } from './_shared.js';
import { writeFailure, writeSuccess } from '../../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

type UiContextDescribeResult = {
  readonly uiContext?: unknown;
  readonly selection?: unknown;
  readonly ui_snapshot?: BridgeUiContextSnapshot;
  readonly selection_snapshot?: BridgeSelectionSnapshot;
  readonly portal?: { readonly kind?: string; readonly id?: string; readonly title?: string };
  readonly page?: { readonly id?: string; readonly title?: string };
  readonly focus?: { readonly id?: string; readonly title?: string };
  readonly anchor?: { readonly source?: string; readonly id?: string; readonly title?: string };
  readonly selection_items?: { readonly kind?: string; readonly total_count?: number; readonly truncated?: boolean };
  readonly remnote_db?: string;
  readonly warnings?: readonly string[];
};

const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));
const staleMs = Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined));
const selectionLimit = Options.integer('selection-limit').pipe(Options.withDefault(5));

export const readUiContextDescribeCommand = Command.make(
  'describe',
  { stateFile, staleMs, selectionLimit },
  ({ stateFile, staleMs, selectionLimit }) =>
    Effect.gen(function* () {
      const data = (yield* invokeWave1Capability('ui-context.describe', {
        stateFile,
        staleMs,
        selectionLimit,
      })) as UiContextDescribeResult;
      const ids = [data.portal?.id, data.page?.id, data.focus?.id, data.anchor?.id]
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map(String);
      const mdLines: string[] = [];
      mdLines.push(
        `Portal: ${data.portal?.title ? `(${data.portal.kind}) ${data.portal.title} [id=${data.portal.id}]` : data.portal?.id ? `(${data.portal.kind}) [id=${data.portal.id}]` : '(unavailable)'}`,
      );
      mdLines.push(
        `Page: ${data.page?.title ? `${data.page.title} [id=${data.page.id}]` : data.page?.id ? `[id=${data.page.id}]` : '(unavailable)'}`,
      );
      mdLines.push(
        `Focus: ${data.focus?.title ? `${data.focus.title} [id=${data.focus.id}]` : data.focus?.id ? `[id=${data.focus.id}]` : '(none)'}`,
      );
      if (!data.focus?.id && data.anchor?.source && data.anchor?.source !== 'none' && data.anchor?.id) {
        mdLines.push(
          `Anchor: (${data.anchor.source}) ${data.anchor?.title ? `${data.anchor.title} [id=${data.anchor.id}]` : `[id=${data.anchor.id}]`}`,
        );
      }
      if (data.selection_items?.kind === 'none' || !data.selection_items?.total_count) mdLines.push('Selection: (none)');
      else mdLines.push(`Selection: ${data.selection_items.total_count}${data.selection_items.truncated ? ' (truncated)' : ''}`);
      yield* writeSuccess({ data, ids, md: `${mdLines.join('\n')}\n` });
    }).pipe(Effect.catchAll(writeFailure)),
);
