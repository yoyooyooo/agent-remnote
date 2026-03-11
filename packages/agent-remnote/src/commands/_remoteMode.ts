import * as Effect from 'effect/Effect';

import { AppConfig } from '../services/AppConfig.js';
import { CliError } from '../services/Errors.js';

function normalizeHints(hints: readonly string[] | undefined): readonly string[] | undefined {
  if (!Array.isArray(hints)) return undefined;
  const out = hints.map((item) => String(item).trim()).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

export function remoteModeUnsupportedError(params: {
  readonly command: string;
  readonly reason: string;
  readonly hints?: readonly string[] | undefined;
  readonly apiBaseUrl?: string | undefined;
}): CliError {
  return new CliError({
    code: 'INVALID_ARGS',
    message: `${params.command} is unavailable when apiBaseUrl is configured: ${params.reason}`,
    exitCode: 2,
    details: {
      command: params.command,
      api_base_url: params.apiBaseUrl,
      reason: params.reason,
    },
    hint: normalizeHints([
      'Run this command on the host if you need direct local DB access.',
      ...(params.hints ?? []),
    ]),
  });
}

export function failInRemoteMode(params: {
  readonly command: string;
  readonly reason: string;
  readonly hints?: readonly string[] | undefined;
}): Effect.Effect<void, CliError, AppConfig> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    if (!cfg.apiBaseUrl) return;
    return yield* Effect.fail(
      remoteModeUnsupportedError({
        command: params.command,
        reason: params.reason,
        hints: params.hints,
        apiBaseUrl: cfg.apiBaseUrl,
      }),
    );
  });
}
