import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import path from 'node:path';

import { invokeWave1Capability } from '../../../lib/business-semantics/modeParityRuntime.js';
import { resolveUserFilePath } from '../../../lib/paths.js';
import { CliError } from '../../../services/Errors.js';
import { writeFailure, writeSuccess } from '../../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

type SelectionOutlineResult = {
  readonly selection?: {
    readonly totalCount?: number;
    readonly remIds?: readonly string[];
  };
  readonly exported_node_count?: number;
  readonly truncated?: boolean;
  readonly roots?: ReadonlyArray<{
    readonly title?: string;
    readonly rootId?: string;
    readonly markdown?: string;
  }>;
};

function normalizeOptionalStateFile(stateFile: string | undefined): string | undefined {
  const trimmed = typeof stateFile === 'string' ? stateFile.trim() : '';
  return trimmed ? path.resolve(resolveUserFilePath(trimmed)) : undefined;
}

const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));
const staleMs = Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined));

const maxDepth = Options.integer('max-depth').pipe(Options.withDefault(10));
const maxNodes = Options.integer('max-nodes').pipe(Options.withDefault(1000));

export const readSelectionOutlineCommand = Command.make(
  'outline',
  {
    stateFile,
    staleMs,
    maxDepth,
    maxNodes,
    excludeProperties: Options.boolean('exclude-properties'),
    includeEmpty: Options.boolean('include-empty'),
    expandReferences: Options.boolean('expand-references'),
    maxReferenceDepth: Options.integer('max-reference-depth').pipe(Options.optional, Options.map(optionToUndefined)),
    detail: Options.boolean('detail'),
  },
  ({
    stateFile,
    staleMs,
    maxDepth,
    maxNodes,
    excludeProperties,
    includeEmpty,
    expandReferences,
    maxReferenceDepth,
    detail,
  }) =>
    Effect.gen(function* () {
      if (maxDepth > 10) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'maxDepth must be <= 10',
            exitCode: 2,
            details: { maxDepth },
          }),
        );
      }

      const data = (yield* invokeWave1Capability('selection.outline', {
        stateFile: normalizeOptionalStateFile(stateFile),
        staleMs,
        maxDepth,
        maxNodes,
        excludeProperties,
        includeEmpty,
        expandReferences,
        maxReferenceDepth,
        detail,
      })) as SelectionOutlineResult;

      const mdParts: string[] = [];
      mdParts.push(`- selected: ${data.selection?.totalCount ?? ''}`);
      mdParts.push(`- roots: ${Array.isArray(data.selection?.remIds) ? data.selection.remIds.length : ''}`);
      mdParts.push(`- exported_nodes: ${data.exported_node_count ?? ''}`);
      mdParts.push(`- truncated: ${data.truncated ? 'true' : 'false'}`);
      mdParts.push('');
      for (const r of Array.isArray(data.roots) ? data.roots : []) {
        const title = String(r?.title ?? r?.rootId ?? '');
        const rootId = String(r?.rootId ?? '');
        if (title || rootId) mdParts.push(`## ${title || rootId} (${rootId || title})`);
        const m = String(r?.markdown ?? '');
        if (m.trim()) mdParts.push(m.trimEnd());
        mdParts.push('');
      }

      yield* writeSuccess({ data, md: mdParts.join('\n').trimEnd() + '\n' });
    }).pipe(Effect.catchAll(writeFailure)),
);
