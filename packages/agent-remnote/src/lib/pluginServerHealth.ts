import * as Duration from 'effect/Duration';
import * as Either from 'effect/Either';
import * as Effect from 'effect/Effect';

import { CliError } from '../services/Errors.js';

export function checkPluginServerHealth(
  baseUrl: string,
  timeoutMs: number,
): Effect.Effect<{ readonly base_url: string }, CliError> {
  return Effect.tryPromise({
    try: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseUrl}/manifest.json`, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`Unexpected response status: ${res.status}`);
        }
        return { base_url: baseUrl };
      } finally {
        clearTimeout(timer);
      }
    },
    catch: (error) =>
      new CliError({
        code: 'PLUGIN_UNAVAILABLE',
        message: 'Plugin server is unavailable',
        exitCode: 1,
        details: { base_url: baseUrl, error: String((error as any)?.message || error) },
      }),
  });
}

export function waitForPluginServerHealth(
  baseUrl: string,
  waitMs: number,
  timeoutMs: number,
): Effect.Effect<void, CliError> {
  return Effect.gen(function* () {
    if (!Number.isFinite(waitMs) || waitMs < 0) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: '--wait must be a non-negative integer (ms)',
          exitCode: 2,
          details: { wait_ms: waitMs },
        }),
      );
    }
    if (waitMs === 0) return;

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const remaining = Math.max(0, deadline - Date.now());
      const res = yield* checkPluginServerHealth(baseUrl, Math.min(timeoutMs, Math.max(1, remaining))).pipe(
        Effect.either,
      );
      if (Either.isRight(res)) return;
      yield* Effect.sleep(Duration.millis(300));
    }

    return yield* Effect.fail(
      new CliError({
        code: 'PLUGIN_UNAVAILABLE',
        message: `Timed out waiting for plugin server to become available (${waitMs}ms)`,
        exitCode: 1,
        details: { base_url: baseUrl, wait_ms: waitMs },
        hint: ['agent-remnote plugin status --json', 'agent-remnote plugin logs --lines 200'],
      }),
    );
  });
}
