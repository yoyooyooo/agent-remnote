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

function collectCommandTokens(raw: readonly string[]): string[] {
  const out = new Set<string>();

  for (const item of raw) {
    const normalized = normalizeToken(String(item ?? ''));
    if (!normalized) continue;

    const unquoted = normalized.replace(/^['"]|['"]$/g, '');
    const base = path.basename(unquoted);

    if (unquoted.includes('agent-remnote') || base.includes('agent-remnote')) {
      out.add('agent-remnote');
    }
    if (base === 'node' || base === 'node.exe') out.add('node');
    if (base === 'tsx' || base === 'tsx.cmd') out.add('tsx');
    if (base.endsWith('.js') || base.endsWith('.ts')) out.add(base);
    if (!unquoted.startsWith('-') && !unquoted.includes('/')) out.add(unquoted);
  }

  out.add('agent-remnote');
  return Array.from(out);
}

function expectedTokens(record: PidRecord): string[] {
  const raw = Array.isArray(record.cmd) ? record.cmd : [];
  return collectCommandTokens(raw);
}

function actualTokens(commandLine: string): Set<string> {
  const parts = commandLine.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return new Set(collectCommandTokens(parts));
}

export function isTrustedPidRecord(record: PidRecord): Effect.Effect<boolean, never, Process> {
  return Effect.gen(function* () {
    const proc = yield* Process;
    const alive = yield* proc.isPidRunning(record.pid);
    if (!alive) return false;

    if (!proc.getCommandLine) return false;
    const commandLine = yield* proc.getCommandLine(record.pid);
    if (!commandLine) return false;

    const expected = expectedTokens(record);
    const actual = actualTokens(commandLine);
    return expected.every((token) => actual.has(token));
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
