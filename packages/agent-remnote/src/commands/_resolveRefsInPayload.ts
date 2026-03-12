import * as Effect from 'effect/Effect';

import { idFieldPathsForOpType } from '../kernel/op-catalog/index.js';
import { collectLeafValues, mapLeafValuesInPlace, parsePathTokens } from '../kernel/op-catalog/pathWalk.js';
import type { AppConfig } from '../services/AppConfig.js';
import { CliError } from '../services/Errors.js';
import { RefResolver } from '../services/RefResolver.js';
import type { WorkspaceBindings } from '../services/WorkspaceBindings.js';

function shouldResolveRef(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  if (s.startsWith('tmp:')) return false;
  if (s.startsWith('remnote://')) return true;
  const idx = s.indexOf(':');
  if (idx <= 0) return false;
  const prefix = s.slice(0, idx).trim().toLowerCase();
  return prefix === 'id' || prefix === 'page' || prefix === 'title' || prefix === 'daily';
}

export function resolveRefsInPayload(params: {
  readonly opType: string;
  readonly payload: Record<string, unknown>;
}): Effect.Effect<Record<string, unknown>, CliError, AppConfig | RefResolver | WorkspaceBindings> {
  return Effect.gen(function* () {
    const refs = yield* RefResolver;
    const out: Record<string, unknown> = structuredClone(params.payload);
    const resolvedRefCache = new Map<string, string>();

    const idPaths = idFieldPathsForOpType(params.opType);
    for (const path of idPaths) {
      const tokens = parsePathTokens(path);
      if (tokens.length === 0) continue;

      const leaves = collectLeafValues(out, tokens);
      if (leaves.length === 0) continue;

      const mapped = yield* Effect.forEach(
        leaves,
        (leaf) =>
          Effect.gen(function* () {
            if (typeof leaf !== 'string') return leaf;
            const refValue = leaf.trim();
            if (!shouldResolveRef(refValue)) return leaf;

            const cached = resolvedRefCache.get(refValue);
            if (cached) return cached;

            const resolved = yield* refs.resolve(refValue);
            resolvedRefCache.set(refValue, resolved);
            return resolved;
          }),
        { concurrency: 1 },
      );

      let idx = 0;
      mapLeafValuesInPlace(out, tokens, () => mapped[idx++]);
    }

    return out;
  });
}
