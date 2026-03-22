import * as Effect from 'effect/Effect';

import { CliError } from '../../services/Errors.js';

import { normalizeRefValue } from './_refValue.js';
export type {
  PlacementSpec,
  ResolvedPlacement,
  RemLayout,
} from '../../lib/business-semantics/placementResolution.js';
export {
  fetchRemLayouts,
  listSiblingOrder,
  resolveLocalDbPath,
  resolveAnchorPlacement,
  resolvePlacementSpec,
  resolveTreePlacementSpec,
} from '../../lib/business-semantics/placementResolution.js';

function invalidArgs(message: string, details?: Record<string, unknown>): CliError {
  return new CliError({
    code: 'INVALID_ARGS',
    message,
    exitCode: 2,
    details,
  });
}

function invalidPlacementSpec(optionName: string, raw: string): CliError {
  return new CliError({
    code: 'INVALID_ARGS',
    message: `Invalid ${optionName} placement spec: ${raw}`,
    exitCode: 2,
    details: { option: optionName, value: raw },
    hint: [
      `Examples: ${optionName} standalone`,
      `Examples: ${optionName} parent:id:P1`,
      `Examples: ${optionName} parent[2]:id:P1`,
      `Examples: ${optionName} before:id:R1`,
      `Examples: ${optionName} after:id:R1`,
    ],
  });
}

export function parsePlacementSpec(
  raw: string,
  options?: { readonly optionName?: string | undefined; readonly allowStandalone?: boolean | undefined },
): Effect.Effect<import('../../lib/business-semantics/placementResolution.js').PlacementSpec, CliError> {
  return Effect.gen(function* () {
    const optionName = options?.optionName ?? '--at';
    const allowStandalone = options?.allowStandalone !== false;
    const text = raw.trim();

    if (!text) {
      return yield* Effect.fail(
        invalidArgs(`${optionName} requires a placement spec`, { option: optionName, value: raw }),
      );
    }

    if (text === 'standalone') {
      if (!allowStandalone) {
        return yield* Effect.fail(
          invalidArgs(`${optionName} does not allow standalone placement`, { option: optionName, value: raw }),
        );
      }
      return { kind: 'standalone' } as const;
    }

    const parentMatch = /^parent(?:\[(\d+)\])?:(.+)$/.exec(text);
    if (parentMatch) {
      const positionText = parentMatch[1];
      const parentRef = normalizeRefValue(parentMatch[2] ?? '');
      if (!parentRef) {
        return yield* Effect.fail(invalidPlacementSpec(optionName, raw));
      }
      const parsedPosition = positionText === undefined ? undefined : Number.parseInt(positionText, 10);
      if (
        positionText !== undefined &&
        (parsedPosition === undefined || !Number.isFinite(parsedPosition) || parsedPosition < 0)
      ) {
        return yield* Effect.fail(invalidPlacementSpec(optionName, raw));
      }
      const position = parsedPosition;

      return {
        kind: 'parent',
        parentRef,
        ...(position !== undefined ? { position } : {}),
      } as const;
    }

    const beforeMatch = /^before:(.+)$/.exec(text);
    if (beforeMatch) {
      const anchorRef = normalizeRefValue(beforeMatch[1] ?? '');
      if (!anchorRef) {
        return yield* Effect.fail(invalidPlacementSpec(optionName, raw));
      }
      return { kind: 'before', anchorRef } as const;
    }

    const afterMatch = /^after:(.+)$/.exec(text);
    if (afterMatch) {
      const anchorRef = normalizeRefValue(afterMatch[1] ?? '');
      if (!anchorRef) {
        return yield* Effect.fail(invalidPlacementSpec(optionName, raw));
      }
      return { kind: 'after', anchorRef } as const;
    }

    return yield* Effect.fail(invalidPlacementSpec(optionName, raw));
  });
}
