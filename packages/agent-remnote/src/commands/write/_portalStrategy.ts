import * as Effect from 'effect/Effect';

import { CliError } from '../../services/Errors.js';

import { parsePlacementSpec, type PlacementSpec } from './_placementSpec.js';

export type PortalStrategy =
  | { readonly kind: 'none' }
  | { readonly kind: 'in_place' }
  | { readonly kind: 'at'; readonly placement: PlacementSpec };

function invalidArgs(message: string, details?: Record<string, unknown>): CliError {
  return new CliError({
    code: 'INVALID_ARGS',
    message,
    exitCode: 2,
    details,
  });
}

export function parsePortalStrategy(raw: string | undefined): Effect.Effect<PortalStrategy, CliError> {
  return Effect.gen(function* () {
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) return { kind: 'none' } satisfies PortalStrategy;
    if (text === 'in-place') return { kind: 'in_place' } satisfies PortalStrategy;
    if (!text.startsWith('at:')) {
      return yield* Effect.fail(
        invalidArgs(`Invalid --portal strategy: ${raw}`, { option: '--portal', value: raw }),
      );
    }
    const placement = yield* parsePlacementSpec(text.slice(3), {
      optionName: '--portal',
      allowStandalone: false,
    });
    return { kind: 'at', placement } satisfies PortalStrategy;
  });
}
