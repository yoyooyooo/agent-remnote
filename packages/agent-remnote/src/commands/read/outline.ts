import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { executeOutlineRemSubtree } from '../../adapters/core.js';

import { tryParseRemnoteLinkFromRef, tryResolveRemnoteDbPathForWorkspaceIdSync } from '../../lib/remnote.js';
import { AppConfig } from '../../services/AppConfig.js';
import { RefResolver } from '../../services/RefResolver.js';
import { CliError } from '../../services/Errors.js';
import { HostApiClient } from '../../services/HostApiClient.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { cliErrorFromUnknown } from '../_tool.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const depth = Options.integer('depth').pipe(Options.optional, Options.map(optionToUndefined));
const offset = Options.integer('offset').pipe(Options.optional, Options.map(optionToUndefined));
const nodes = Options.integer('nodes').pipe(Options.optional, Options.map(optionToUndefined));
const format = Options.choice('format', ['md', 'json'] as const).pipe(Options.optional, Options.map(optionToUndefined));
const id = Options.text('id').pipe(Options.optional, Options.map(optionToUndefined));
const ref = Options.text('ref').pipe(Options.optional, Options.map(optionToUndefined));

export const readOutlineCommand = Command.make(
  'outline',
  {
    id,
    ref,
    depth,
    offset,
    nodes,
    format,
    excludeProperties: Options.boolean('exclude-properties'),
    includeEmpty: Options.boolean('include-empty'),
    expandReferences: Options.boolean('expand-references'),
    maxReferenceDepth: Options.integer('max-reference-depth').pipe(Options.optional, Options.map(optionToUndefined)),
    detail: Options.boolean('detail'),
  },
  ({
    id,
    ref,
    depth,
    offset,
    nodes,
    format,
    excludeProperties,
    includeEmpty,
    expandReferences,
    maxReferenceDepth,
    detail,
  }) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      const hostApi = yield* HostApiClient;
      const refs = yield* RefResolver;

      if (id && ref) {
        return yield* Effect.fail(
          new CliError({ code: 'INVALID_ARGS', message: 'Choose only one of --id or --ref', exitCode: 2 }),
        );
      }

      if (cfg.apiBaseUrl) {
        const data = yield* hostApi.readOutline({
          baseUrl: cfg.apiBaseUrl,
          body: {
            id,
            ref,
            depth,
            offset,
            nodes,
            format: format === 'json' ? 'json' : format === 'md' ? 'md' : undefined,
            excludeProperties,
            includeEmpty,
            expandReferences,
            maxReferenceDepth,
            detail,
          },
        });
        yield* writeSuccess({ data, md: (data as any).markdown ?? '' });
        return;
      }

      const link = ref ? tryParseRemnoteLinkFromRef(ref) : undefined;
      const resolvedId = ref ? (link?.remId ?? (yield* refs.resolve(ref))) : id;
      if (!resolvedId) {
        return yield* Effect.fail(
          new CliError({ code: 'INVALID_ARGS', message: 'You must provide --id or --ref', exitCode: 2 }),
        );
      }

      const inferredDbPath = link?.workspaceId
        ? tryResolveRemnoteDbPathForWorkspaceIdSync(link.workspaceId)
        : undefined;
      const dbPath = cfg.remnoteDb ?? inferredDbPath;
      const result = yield* Effect.tryPromise({
        try: async () =>
          await executeOutlineRemSubtree({
            id: resolvedId,
            dbPath,
            maxDepth: depth as any,
            startOffset: offset as any,
            maxNodes: nodes as any,
            format: format === 'json' ? 'json' : 'markdown',
            excludeProperties,
            includeEmpty,
            expandReferences: expandReferences === false ? false : undefined,
            maxReferenceDepth: maxReferenceDepth as any,
            detail,
          } as any),
        catch: (e) => cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE' }),
      });
      yield* writeSuccess({ data: result, md: (result as any).markdown ?? '' });
    }).pipe(Effect.catchAll(writeFailure)),
);
