import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { executeInspectRemDoc } from '../../adapters/core.js';

import { AppConfig } from '../../services/AppConfig.js';
import { failInRemoteMode } from '../_remoteMode.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { cliErrorFromUnknown } from '../_tool.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const maxReferenceDepth = Options.integer('max-reference-depth').pipe(Options.optional, Options.map(optionToUndefined));

export const readInspectCommand = Command.make(
  'inspect',
  {
    id: Options.text('id'),
    expandReferences: Options.boolean('expand-references'),
    maxReferenceDepth,
  },
  ({ id, expandReferences, maxReferenceDepth }) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      yield* failInRemoteMode({
        command: 'rem inspect',
        reason: 'this command still inspects the local RemNote database directly',
      });
      const result = yield* Effect.tryPromise({
        try: async () =>
          await executeInspectRemDoc({
            id,
            dbPath: cfg.remnoteDb,
            expandReferences,
            maxReferenceDepth: maxReferenceDepth as any,
          } as any),
        catch: (e) => cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE' }),
      });

      const summaryText = (result as any)?.summary?.text ? String((result as any).summary.text) : '';
      const refs = Array.isArray((result as any)?.summary?.references) ? (result as any).summary.references.length : 0;
      const md = [
        `- id: ${String((result as any).id ?? id)}`,
        summaryText ? `- text: ${summaryText}` : '',
        `- references: ${refs}`,
      ]
        .filter(Boolean)
        .join('\n');
      yield* writeSuccess({ data: result, md });
    }).pipe(Effect.catchAll(writeFailure)),
);
