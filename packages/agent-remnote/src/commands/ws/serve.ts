import { Command } from '@effect/cli';
import * as Effect from 'effect/Effect';

import { AppConfig } from '../../services/AppConfig.js';
import { CliError, isCliError } from '../../services/Errors.js';
import { runWsBridgeRuntime } from '../../runtime/ws-bridge/runWsBridgeRuntime.js';
import { writeFailure } from '../_shared.js';

function parseWsUrl(url: string): { readonly host: string; readonly port: number; readonly path: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new CliError({ code: 'INVALID_ARGS', message: `Invalid wsUrl: ${url}`, exitCode: 2 });
  }

  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') {
    throw new CliError({ code: 'INVALID_ARGS', message: `wsUrl protocol must be ws/wss: ${url}`, exitCode: 2 });
  }

  const port = u.port ? Number(u.port) : u.protocol === 'wss:' ? 443 : 80;
  const host = u.hostname && u.hostname.length > 0 ? u.hostname : 'localhost';
  const path = u.pathname && u.pathname.length > 0 ? u.pathname : '/ws';
  if (!Number.isFinite(port) || port <= 0) {
    throw new CliError({ code: 'INVALID_ARGS', message: `Invalid wsUrl port: ${url}`, exitCode: 2 });
  }
  if (!path.startsWith('/')) {
    throw new CliError({ code: 'INVALID_ARGS', message: `Invalid wsUrl path: ${url}`, exitCode: 2 });
  }

  return { host, port, path };
}

export const wsServeCommand = Command.make('serve', {}, () =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const { host, port, path } = yield* Effect.try({
      try: () => parseWsUrl(cfg.wsUrl),
      catch: (e) =>
        isCliError(e)
          ? e
          : new CliError({
              code: 'INVALID_ARGS',
              message: 'Invalid wsUrl',
              exitCode: 2,
              details: { ws_url: cfg.wsUrl, error: String((e as any)?.message || e) },
            }),
    });

    yield* runWsBridgeRuntime({ host, port, path });
  }).pipe(Effect.catchAll(writeFailure)),
);
