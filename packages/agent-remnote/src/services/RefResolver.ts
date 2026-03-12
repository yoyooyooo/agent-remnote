import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import { executeSearchRemOverview } from '../adapters/core.js';

import { AppConfig } from './AppConfig.js';
import { CliError } from './Errors.js';
import { remoteModeUnsupportedError } from '../commands/_remoteMode.js';
import { tryParseRemnoteLink } from '../lib/remnote.js';

export interface RefResolverService {
  readonly resolve: (ref: string, options?: { readonly dbPath?: string | undefined }) => Effect.Effect<string, CliError, AppConfig>;
}

export class RefResolver extends Context.Tag('RefResolver')<RefResolver, RefResolverService>() {}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseRef(input: string): { readonly kind: 'id' | 'title' | 'page' | 'daily'; readonly value: string } {
  const raw = input.trim();
  const link = tryParseRemnoteLink(raw);
  if (link?.remId) {
    return { kind: 'id', value: link.remId };
  }
  const idx = raw.indexOf(':');
  if (idx <= 0) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: `Invalid ref: ${input}`,
      exitCode: 2,
      hint: [
        'Example: --ref id:xxx',
        'Example: --ref "remnote://w/<workspaceId>/<remId>"',
        'Example: --ref page:Demo',
        'Example: --ref title:Demo',
        'Example: --ref daily:today',
        'Example: --ref daily:-1',
      ],
    });
  }
  const kind = raw.slice(0, idx).trim();
  const value = stripQuotes(raw.slice(idx + 1));
  if (!value) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: `Invalid ref (missing value): ${input}`,
      exitCode: 2,
    });
  }
  if (kind === 'id' || kind === 'title' || kind === 'daily') {
    if (kind === 'id') {
      const link2 = tryParseRemnoteLink(value);
      return { kind, value: link2?.remId ?? value };
    }
    return { kind, value };
  }
  if (kind === 'page') {
    return { kind, value };
  }
  throw new CliError({
    code: 'INVALID_ARGS',
    message: `Unsupported ref: ${input}`,
    exitCode: 2,
    hint: ['Supported prefixes: id:/page:/title:/daily:'],
  });
}

function parseDailyOffset(value: string): number {
  const v = value.trim().toLowerCase();
  if (v === 'today' || v === 'now' || v === '0') return 0;
  if (v === 'yesterday') return -1;
  if (v === 'tomorrow') return 1;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: `Invalid daily ref: ${value} (expected today/yesterday/tomorrow or an integer offset)`,
      exitCode: 2,
    });
  }
  return n;
}

export const RefResolverLive = Layer.succeed(RefResolver, {
  resolve: (ref, options) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      const parsed = yield* Effect.try({
        try: () => parseRef(ref),
        catch: (e) =>
          e && typeof e === 'object' && (e as any)._tag === 'CliError'
            ? (e as any)
            : new CliError({ code: 'INVALID_ARGS', message: `Invalid ref: ${ref}`, exitCode: 2 }),
      });

      if (cfg.apiBaseUrl && parsed.kind !== 'id') {
        return yield* Effect.fail(
          remoteModeUnsupportedError({
            command: `ref resolution (${ref})`,
            reason: 'this path still resolves refs by reading the local RemNote database',
            hints: [
              'Use a remote-capable command that accepts --ref and forwards it to the host API.',
              'If no remote endpoint exists yet, run the command on the host.',
            ],
            apiBaseUrl: cfg.apiBaseUrl,
          }),
        );
      }

      if (parsed.kind === 'id') return parsed.value;

      const dailyOffset =
        parsed.kind === 'daily'
          ? yield* Effect.try({
              try: () => parseDailyOffset(parsed.value),
              catch: (e) =>
                e && typeof e === 'object' && (e as any)._tag === 'CliError'
                  ? (e as any)
                  : new CliError({
                      code: 'INVALID_ARGS',
                      message: `Invalid daily ref: ${parsed.value}`,
                      exitCode: 2,
                    }),
            })
          : undefined;

      const queryInput =
        parsed.kind === 'title' || parsed.kind === 'page'
          ? { query: parsed.value }
          : { query: 'date', useCurrentDate: true, dateOffsetDays: dailyOffset };

      const result = yield* Effect.tryPromise({
        try: async () =>
          await executeSearchRemOverview({
            ...(queryInput as any),
            dbPath: options?.dbPath ?? cfg.remnoteDb,
            limit: 1,
            preferExact: true,
            exactFirstSingle: true,
            pagesOnly: parsed.kind === 'page' ? true : undefined,
          } as any),
        catch: (e) =>
          new CliError({
            code: 'DB_UNAVAILABLE',
            message: String((e as any)?.message || e || 'RemNote DB is unavailable'),
            exitCode: 1,
          }),
      });

      const first = Array.isArray((result as any).matches) ? (result as any).matches[0] : undefined;
      const id = first?.id ? String(first.id) : '';
      if (!id) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: `No Rem found for ref: ${ref}`,
            exitCode: 2,
          }),
        );
      }
      return id;
    }),
} satisfies RefResolverService);
