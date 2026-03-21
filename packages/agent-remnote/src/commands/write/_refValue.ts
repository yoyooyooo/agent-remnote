import * as Effect from 'effect/Effect';

import { tryParseRemnoteLink } from '../../lib/remnote.js';
import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { RefResolver } from '../../services/RefResolver.js';
import { WorkspaceBindings } from '../../services/WorkspaceBindings.js';

function invalidArgs(message: string, details?: Record<string, unknown>): CliError {
  return new CliError({
    code: 'INVALID_ARGS',
    message,
    exitCode: 2,
    details,
  });
}

export function normalizeRefValue(raw: string): string {
  const trimmed = raw.trim();
  const link = tryParseRemnoteLink(trimmed);
  if (link?.remId) return link.remId;
  return trimmed;
}

export function looksLikeRefValue(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  if (value.startsWith('remnote://') || value.startsWith('http://') || value.startsWith('https://')) return true;
  const idx = value.indexOf(':');
  if (idx <= 0) return false;
  const prefix = value.slice(0, idx).trim().toLowerCase();
  return prefix === 'id' || prefix === 'page' || prefix === 'title' || prefix === 'daily';
}

export function resolveRefValue(
  raw: string,
): Effect.Effect<string, CliError, AppConfig | RefResolver | WorkspaceBindings> {
  return Effect.gen(function* () {
    const normalized = normalizeRefValue(raw);
    if (!normalized) {
      return yield* Effect.fail(invalidArgs(`Invalid ref value: ${raw}`));
    }

    if (!looksLikeRefValue(raw)) return normalized;

    const refs = yield* RefResolver;
    return yield* refs.resolve(raw);
  });
}
