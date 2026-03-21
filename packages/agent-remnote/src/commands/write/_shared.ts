import * as Options from '@effect/cli/Options';
import * as Option from 'effect/Option';
import * as Effect from 'effect/Effect';

import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { RemDb } from '../../services/RemDb.js';
import { WorkspaceBindings } from '../../services/WorkspaceBindings.js';

import { fetchRemLayouts, listSiblingOrder, resolveLocalDbPath } from './_placementSpec.js';

export function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

export function readOptionalText(name: string) {
  return Options.text(name).pipe(Options.optional, Options.map(optionToUndefined));
}

export const writeCommonOptions = {
  notify: Options.boolean('no-notify').pipe(Options.map((v) => !v)),
  ensureDaemon: Options.boolean('no-ensure-daemon').pipe(Options.map((v) => !v)),
  wait: Options.boolean('wait'),
  timeoutMs: Options.integer('timeout-ms').pipe(Options.optional, Options.map(optionToUndefined)),
  pollMs: Options.integer('poll-ms').pipe(Options.optional, Options.map(optionToUndefined)),
  dryRun: Options.boolean('dry-run'),

  priority: Options.integer('priority').pipe(Options.optional, Options.map(optionToUndefined)),
  clientId: readOptionalText('client-id'),
  idempotencyKey: readOptionalText('idempotency-key'),
  meta: readOptionalText('meta'),
} as const;

export function invalidArgs(message: string, details?: Record<string, unknown>): CliError {
  return new CliError({
    code: 'INVALID_ARGS',
    message,
    exitCode: 2,
    details,
  });
}

export function normalizeOptionalText(raw: string | undefined): string | undefined {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed ? trimmed : undefined;
}

export type StableSiblingRange = {
  readonly orderedRemIds: readonly string[];
  readonly parentId: string;
  readonly position: number;
};

export function requireStableSiblingRange(params: {
  readonly remIds: readonly string[];
  readonly missingMessage: string;
  readonly mismatchMessage: string;
}): Effect.Effect<StableSiblingRange, CliError, AppConfig | RemDb | WorkspaceBindings> {
  return Effect.gen(function* () {
    const remDb = yield* RemDb;
    const dbPath = yield* resolveLocalDbPath();
    const layouts = yield* remDb.withDb(dbPath, async (db) => fetchRemLayouts(db, params.remIds)).pipe(
      Effect.map((result) => result.result),
    );

    const entries = params.remIds.map((id) => layouts.get(id)).filter((value): value is NonNullable<typeof value> => Boolean(value));
    if (entries.length !== params.remIds.length) {
      return yield* Effect.fail(
        invalidArgs(params.missingMessage, {
          expected: params.remIds.length,
          resolved: entries.length,
        }),
      );
    }

    const parentIds = Array.from(new Set(entries.map((entry) => entry.parentId).filter((value): value is string => Boolean(value))));
    if (parentIds.length !== 1) {
      return yield* Effect.fail(
        invalidArgs(params.mismatchMessage, {
          parent_count: parentIds.length,
        }),
      );
    }

    const siblingOrder = yield* remDb.withDb(dbPath, async (db) => listSiblingOrder(db, parentIds[0]!)).pipe(
      Effect.map((result) => result.result),
    );
    const indexed = entries
      .map((entry) => ({ id: entry.id, index: siblingOrder.indexOf(entry.id) }))
      .sort((a, b) => a.index - b.index);

    const first = indexed[0];
    if (!first || first.index < 0) {
      return yield* Effect.fail(invalidArgs('Failed to resolve sibling placement'));
    }

    for (let offset = 0; offset < indexed.length; offset += 1) {
      const current = indexed[offset]!;
      if (current.index !== first.index + offset) {
        return yield* Effect.fail(
          invalidArgs(params.mismatchMessage, {
            actual_positions: indexed.map((item) => item.index),
          }),
        );
      }
    }

    return {
      orderedRemIds: indexed.map((item) => item.id),
      parentId: parentIds[0]!,
      position: first.index,
    };
  });
}

export function resolveCreateDestinationTitle(params: {
  readonly explicitTitle?: string | undefined;
  readonly inferredTitle?: string | undefined;
  readonly sourceKind: 'explicit_from' | 'selection';
  readonly sourceCount: number;
}): Effect.Effect<string, CliError> {
  return Effect.gen(function* () {
    const destinationTitle = params.explicitTitle ?? params.inferredTitle;
    if (destinationTitle) return destinationTitle;

    if (params.sourceKind === 'explicit_from') {
      return yield* Effect.fail(
        invalidArgs(
          params.sourceCount > 1
            ? 'rem create with multiple --from values requires --title'
            : 'rem create could not infer a title from the single --from Rem; pass --title explicitly',
        ),
      );
    }

    return yield* Effect.fail(
      invalidArgs(
        params.sourceCount > 1
          ? 'rem create --from-selection with multiple selected roots requires --title'
          : 'rem create --from-selection could not infer a title from the single selected Rem; pass --title explicitly',
      ),
    );
  });
}
