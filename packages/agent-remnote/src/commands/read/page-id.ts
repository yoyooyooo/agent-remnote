import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { executeResolveRemPage } from '../../adapters/core.js';

import { requireResolvedWorkspace } from '../../lib/workspaceResolver.js';
import { tryParseRemnoteLinkFromRef } from '../../lib/remnote.js';
import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { RefResolver } from '../../services/RefResolver.js';
import { failInRemoteMode } from '../_remoteMode.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { cliErrorFromUnknown } from '../_tool.js';

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
      yield* failInRemoteMode({
        command: 'rem page-id',
        reason: 'this command still resolves page ancestry from the local RemNote database',
      });
      const refs = yield* RefResolver;

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

      const dbPath = cfg.remnoteDb ?? (yield* requireResolvedWorkspace({ ref: hasRef ? ref! : undefined })).dbPath;
      const link = hasRef ? tryParseRemnoteLinkFromRef(ref!) : undefined;
      const ids = hasRef ? [link?.remId ?? (yield* refs.resolve(ref!, { dbPath }))] : id.map(String);
      if (ids.length === 0) {
        return yield* Effect.fail(
          new CliError({ code: 'INVALID_ARGS', message: 'Provide at least one Rem ID via --id', exitCode: 2 }),
        );
      }

      const result = yield* Effect.tryPromise({
        try: async () =>
          await executeResolveRemPage({
            ids,
            dbPath,
            maxHops: maxHops as any,
            detail,
          } as any),
        catch: (e) => cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE' }),
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
