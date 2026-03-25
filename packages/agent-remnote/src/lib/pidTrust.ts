import * as Effect from 'effect/Effect';
import path from 'node:path';

import { CliError } from '../services/Errors.js';
import { Process } from '../services/Process.js';

type PidRecord = {
  readonly pid: number;
  readonly cmd?: readonly string[] | undefined;
};

function normalizeToken(value: string): string {
  return value.trim().replace(/\\/g, '/').toLowerCase();
}

function expectedTokens(record: PidRecord): string[] {
  const raw = Array.isArray(record.cmd) ? record.cmd : [];
  const out = raw
    .map((item) => normalizeToken(String(item ?? '')))
    .filter(Boolean)
    .map((item) => path.basename(item))
    .filter((item) => item === 'node' || item === 'tsx' || item.endsWith('.js') || item.endsWith('.ts') || item.includes('agent-remnote'));
  return Array.from(new Set(out));
}

export function isTrustedPidRecord(record: PidRecord): Effect.Effect<boolean, never, Process> {
  return Effect.gen(function* () {
    const proc = yield* Process;
    const alive = yield* proc.isPidRunning(record.pid);
    if (!alive) return false;

    if (!proc.getCommandLine) return true;
    const commandLine = yield* proc.getCommandLine(record.pid);
    if (!commandLine) return false;

    const normalizedActual = normalizeToken(commandLine);
    const expected = expectedTokens(record);
    if (expected.length === 0) {
      return normalizedActual.includes('agent-remnote');
    }
    return expected.every((token) => normalizedActual.includes(token));
  });
}

export function requireTrustedPidRecord(params: {
  readonly record: PidRecord;
  readonly pidFilePath: string;
}): Effect.Effect<void, CliError, Process> {
  return Effect.gen(function* () {
    const trusted = yield* isTrustedPidRecord(params.record);
    if (trusted) return;

    return yield* Effect.fail(
      new CliError({
        code: 'INTERNAL',
        message: 'Refusing to operate on a pidfile that does not match a live agent-remnote process',
        exitCode: 1,
        details: {
          pid: params.record.pid,
          pid_file: params.pidFilePath,
          cmd: params.record.cmd ?? [],
        },
      }),
    );
  });
}
