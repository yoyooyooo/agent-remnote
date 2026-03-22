import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { invokeWave1Capability } from '../../lib/business-semantics/modeParityRuntime.js';
import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { writeFailure, writeSuccess } from '../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const ref = Options.text('ref').pipe(Options.optional, Options.map(optionToUndefined));
const id = Options.text('id').pipe(Options.repeated);
const maxHops = Options.integer('max-hops').pipe(Options.optional, Options.map(optionToUndefined));

export const readPageIdCommand = Command.make(
  'page-id',
  { ref, id, maxHops, detail: Options.boolean('detail') },
  ({ ref, id, maxHops, detail }) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;

      const hasRef = typeof ref === 'string' && ref.trim().length > 0;
      const hasIds = Array.isArray(id) && id.length > 0;
      if ((hasRef ? 1 : 0) + (hasIds ? 1 : 0) !== 1) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'You must provide exactly one input: --ref or --id (repeatable)',
            exitCode: 2,
            hint: [
              'Example: agent-remnote rem page-id --id <remId>',
              'Example: agent-remnote rem page-id --ref "id:<remId>"',
            ],
          }),
        );
      }

      const result: any = yield* invokeWave1Capability('read.page-id', {
        ref: hasRef ? ref : undefined,
        ids: hasRef ? undefined : id.map(String),
        maxHops,
        detail,
      });

      const results = Array.isArray((result as any).results) ? ((result as any).results as any[]) : [];
      const pageIds = results.map((r) => (r && typeof r.pageId === 'string' ? r.pageId : '')).filter(Boolean);

      if (cfg.format === 'ids') {
        const bad = results.find((r) => !r || r.found !== true || typeof r.pageId !== 'string' || !r.pageId.trim());
        if (bad) {
          return yield* Effect.fail(
            new CliError({
              code: 'INVALID_ARGS',
              message: 'Some Rems were not found/resolved; cannot output --ids (use --json for details)',
              exitCode: 2,
              details: { bad, count: results.length },
            }),
          );
        }
      }

      yield* writeSuccess({ data: result, ids: pageIds, md: (result as any).markdown ?? '' });
    }).pipe(Effect.catchAll(writeFailure)),
);
