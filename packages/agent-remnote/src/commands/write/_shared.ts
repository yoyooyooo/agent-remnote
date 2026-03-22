import * as Options from '@effect/cli/Options';
import * as Option from 'effect/Option';
import * as Effect from 'effect/Effect';

import { CliError } from '../../services/Errors.js';
export { requireStableSiblingRange, type StableSiblingRange } from '../../lib/business-semantics/selectionResolution.js';

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

export function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
