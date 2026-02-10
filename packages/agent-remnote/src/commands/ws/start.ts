import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { AppConfig } from '../../services/AppConfig.js';
import { CliError, isCliError } from '../../services/Errors.js';
import { runWsBridgeRuntime } from '../../runtime/ws-bridge/runWsBridgeRuntime.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { WS_START_WAIT_DEFAULT_MS, startWsSupervisor } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

function parseWsUrl(url: string): { readonly host: string; readonly port: number; readonly path: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new CliError({ code: 'INVALID_ARGS', message: `Invalid wsUrl: ${url}`, exitCode: 2 });
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

const pidFile = Options.text('pid-file').pipe(Options.optional, Options.map(optionToUndefined));
const logFile = Options.text('log-file').pipe(Options.optional, Options.map(optionToUndefined));

export const wsStartCommand = Command.make(
  'start',
  {
    foreground: Options.boolean('foreground'),
    wait: Options.integer('wait').pipe(Options.withDefault(WS_START_WAIT_DEFAULT_MS)),
    pidFile,
    logFile,
  },
  ({ foreground, wait, pidFile, logFile }) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;

      if (foreground) {
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
        return;
      }

      const result = yield* startWsSupervisor({ waitMs: wait, pidFile, logFile });
      yield* writeSuccess({
        data: result,
        md: `- started: ${result.started}\n- pid: ${result.pid ?? ''}\n- pid_file: ${result.pid_file}\n- log_file: ${result.log_file}\n`,
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
