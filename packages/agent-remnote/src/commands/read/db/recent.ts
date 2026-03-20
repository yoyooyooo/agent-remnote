import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { executeSummarizeRecentActivity } from '../../../adapters/core.js';
import { AppConfig } from '../../../services/AppConfig.js';
import { CliError } from '../../../services/Errors.js';
import { RemDb } from '../../../services/RemDb.js';
import { writeFailure, writeSuccess } from '../../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function formatCounts(counts: { readonly total: number; readonly created: number; readonly modified_existing: number }): string {
  return `total=${counts.total}, created=${counts.created}, modified_existing=${counts.modified_existing}`;
}

function assertTimezoneInput(timezone: string): void {
  const effective = timezone.trim();
  new Intl.DateTimeFormat('en-CA', { timeZone: effective, year: 'numeric', month: '2-digit', day: '2-digit' });
}

const days = Options.integer('days').pipe(Options.optional, Options.map(optionToUndefined));
const kind = Options.choice('kind', ['all', 'created', 'modified_existing'] as const).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);
const aggregate = Options.choice('aggregate', ['day', 'parent'] as const).pipe(Options.repeated);
const timezone = Options.text('timezone').pipe(Options.optional, Options.map(optionToUndefined));
const itemLimit = Options.integer('item-limit').pipe(Options.optional, Options.map(optionToUndefined));
const aggregateLimit = Options.integer('aggregate-limit').pipe(Options.optional, Options.map(optionToUndefined));

export const dbRecentCommand = Command.make(
  'recent',
  {
    days,
    kind,
    aggregate,
    timezone,
    itemLimit,
    aggregateLimit,
  },
  ({ days, kind, aggregate, timezone, itemLimit, aggregateLimit }) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      const remDb = yield* RemDb;

      if (cfg.apiBaseUrl) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'db recent is local-only when apiBaseUrl is configured',
            exitCode: 2,
            details: { apiBaseUrl: cfg.apiBaseUrl },
          }),
        );
      }

      const effectiveDays = clampInt(days ?? 15, 1, 3650);
      const effectiveKind = kind ?? 'all';
      const normalizedTimezone = timezone?.trim();
      const effectiveItemLimit = clampInt(itemLimit ?? 50, 1, 500);
      const effectiveAggregateLimit = clampInt(aggregateLimit ?? 20, 1, 200);
      const aggregateDimensions = Array.from(new Set(aggregate));

      if (timezone !== undefined) {
        const timezoneCheck = Effect.try({
          try: () => assertTimezoneInput(normalizedTimezone ?? ''),
          catch: () =>
            new CliError({
              code: 'INVALID_ARGS',
              message: `Invalid timezone: ${timezone}`,
              exitCode: 2,
              details: { timezone },
            }),
        });
        yield* timezoneCheck;
      }
      const effectiveTimezone = normalizedTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';

      const result = yield* remDb.withDb(cfg.remnoteDb, (db) =>
        executeSummarizeRecentActivity(db as any, {
          days: effectiveDays,
          kind: effectiveKind,
          aggregates: aggregateDimensions,
          timezone: effectiveTimezone,
          itemLimit: effectiveItemLimit,
          aggregateLimit: effectiveAggregateLimit,
        }),
      );

      const data = {
        db_path: result.info.dbPath,
        resolution: result.info.source,
        days: result.result.days,
        timezone: result.result.timezone,
        kind: effectiveKind,
        aggregate_dimensions: aggregateDimensions,
        item_limit: effectiveItemLimit,
        aggregate_limit: effectiveAggregateLimit,
        cutoff_ms: result.result.cutoff_ms,
        counts: result.result.counts,
        items: result.result.items,
        aggregates: result.result.aggregates,
      };

      const mdLines = [
        `# Recent Activity (${effectiveDays}d)`,
        '',
        `- db: \`${result.info.dbPath}\``,
        `- timezone: \`${result.result.timezone}\``,
        `- kind: \`${effectiveKind}\``,
        `- counts: ${formatCounts(result.result.counts)}`,
        '',
      ];

      if (result.result.items.length > 0) {
        mdLines.push('## Items', '');
        for (const item of result.result.items) {
          mdLines.push(`- [${item.activity_kind}] ${item.preview} \`${item.id}\``);
        }
        mdLines.push('');
      }

      if (result.result.aggregates.length > 0) {
        mdLines.push('## Aggregates', '');
        for (const entry of result.result.aggregates) {
          mdLines.push(`- ${entry.dimension}:${entry.key} (${formatCounts(entry.counts)})`);
        }
      }

      yield* writeSuccess({
        data,
        ids: result.result.items.map((item) => item.id),
        md: mdLines.join('\n').trimEnd() + '\n',
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
