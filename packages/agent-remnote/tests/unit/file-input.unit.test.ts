import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Option from 'effect/Option';

import { FileInput, FileInputLive } from '../../src/services/FileInput.js';

function read(spec: string, maxBytes?: number) {
  return Effect.gen(function* () {
    const svc = yield* FileInput;
    return yield* svc.readTextFromFileSpec({ spec, maxBytes });
  }).pipe(Effect.provide(FileInputLive));
}

async function runExit(spec: string, maxBytes?: number) {
  return Effect.runPromise(read(spec, maxBytes).pipe(Effect.exit));
}

function unwrapCliError(exit: Exit.Exit<unknown, unknown>) {
  if (Exit.isSuccess(exit)) throw new Error('Expected failure exit');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('Expected failure cause');
  return failure.value as any;
}

describe('FileInput (unit)', () => {
  it('reads @file specs', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'agent-remnote-file-input-'));
    try {
      const filePath = path.join(tmp, 'a.md');
      await writeFile(filePath, '# Hello\n', 'utf8');

      const text = await Effect.runPromise(read(`@${filePath}`));
      expect(text).toBe('# Hello\n');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('expands ~ in file paths', async () => {
    const tmp = await mkdtemp(path.join(os.homedir(), 'agent-remnote-file-input-home-'));
    try {
      const filePath = path.join(tmp, 'b.md');
      await writeFile(filePath, 'ok', 'utf8');

      const rel = path.relative(os.homedir(), filePath);
      const spec = `~/${rel}`;
      const text = await Effect.runPromise(read(`@${spec}`));
      expect(text).toBe('ok');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('fails with INVALID_ARGS when @ has empty path', async () => {
    const exit = await runExit('@');
    const error = unwrapCliError(exit);
    expect(error).toMatchObject({ _tag: 'CliError', code: 'INVALID_ARGS', exitCode: 2 });
  });

  it('fails with INVALID_ARGS when file does not exist', async () => {
    const exit = await runExit('@/path/does/not/exist.md');
    const error = unwrapCliError(exit);
    expect(error).toMatchObject({ _tag: 'CliError', code: 'INVALID_ARGS', exitCode: 2 });
  });

  it('fails with PAYLOAD_TOO_LARGE when file exceeds maxBytes', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'agent-remnote-file-input-'));
    try {
      const filePath = path.join(tmp, 'big.txt');
      await writeFile(filePath, '0123456789abcdef', 'utf8');

      const exit = await runExit(`@${filePath}`, 4);
      const error = unwrapCliError(exit);
      expect(error).toMatchObject({ _tag: 'CliError', code: 'PAYLOAD_TOO_LARGE', exitCode: 2 });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('fails fast when reading from stdin while TTY', async () => {
    const stdinAny = process.stdin as any;
    const prev = stdinAny.isTTY;
    stdinAny.isTTY = true;
    try {
      const exit = await runExit('-');
      const error = unwrapCliError(exit);
      expect(error).toMatchObject({ _tag: 'CliError', code: 'INVALID_ARGS', exitCode: 2 });
    } finally {
      stdinAny.isTTY = prev;
    }
  });
});
