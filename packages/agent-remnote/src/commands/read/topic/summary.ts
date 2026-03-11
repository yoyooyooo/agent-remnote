import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { executeSummarizeTopicActivity } from '../../../adapters/core.js';

import { AppConfig } from '../../../services/AppConfig.js';
import { CliError } from '../../../services/Errors.js';
import { failInRemoteMode } from '../../_remoteMode.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { cliErrorFromUnknown } from '../../_tool.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const keywords = Options.text('keywords').pipe(Options.optional, Options.map(optionToUndefined));
const query = Options.text('query').pipe(Options.optional, Options.map(optionToUndefined));
const timeRange = Options.text('time').pipe(Options.optional, Options.map(optionToUndefined));

const maxResults = Options.integer('max-results').pipe(Options.optional, Options.map(optionToUndefined));
const maxNodesPerResult = Options.integer('max-nodes').pipe(Options.optional, Options.map(optionToUndefined));
const groupBy = Options.choice('group-by', ['none', 'parent', 'date'] as const).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);

export const topicSummaryCommand = Command.make(
  'summary',
  { keywords, query, timeRange, maxResults, maxNodesPerResult, groupBy },
  ({ keywords, query, timeRange, maxResults, maxNodesPerResult, groupBy }) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      yield* failInRemoteMode({
        command: 'topic summary',
        reason: 'this command still summarizes topics from the local RemNote database',
      });

      const keywordList = keywords
        ? keywords
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      const queryText = query?.trim() || undefined;
      if ((!keywordList || keywordList.length === 0) && !queryText) {
        return yield* Effect.fail(
          new CliError({ code: 'INVALID_ARGS', message: 'Provide --keywords or --query', exitCode: 2 }),
        );
      }

      const result = yield* Effect.tryPromise({
        try: async () =>
          await executeSummarizeTopicActivity({
            keywords: keywordList,
            query: queryText,
            timeRange: timeRange as any,
            maxResults: maxResults as any,
            maxNodesPerResult: maxNodesPerResult as any,
            groupBy: groupBy as any,
            dbPath: cfg.remnoteDb,
          } as any),
        catch: (e) => cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE' }),
      });

      yield* writeSuccess({ data: result, md: (result as any).markdown ?? '' });
    }).pipe(Effect.catchAll(writeFailure)),
);
