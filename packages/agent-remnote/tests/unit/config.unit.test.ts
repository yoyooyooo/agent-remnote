import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';

import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Option from 'effect/Option';

import { buildCliEnvConfigProvider } from '../../src/services/CliConfigProvider.js';
import { resolveConfig } from '../../src/services/Config.js';

function runWithProvider(cli: ReadonlyMap<string, string>, env: NodeJS.ProcessEnv = {}) {
  const provider = buildCliEnvConfigProvider({ cli, env });
  return Effect.runPromise(resolveConfig().pipe(Effect.withConfigProvider(provider)));
}

async function runExitWithProvider(cli: ReadonlyMap<string, string>, env: NodeJS.ProcessEnv = {}) {
  const provider = buildCliEnvConfigProvider({ cli, env });
  return Effect.runPromise(resolveConfig().pipe(Effect.withConfigProvider(provider), Effect.exit));
}

function unwrapCliError(exit: Exit.Exit<unknown, unknown>) {
  if (Exit.isSuccess(exit)) throw new Error('Expected failure exit');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('Expected failure cause');
  return failure.value as any;
}

describe('Config (unit)', () => {
  it('applies defaults when unset', async () => {
    const cfg = await runWithProvider(new Map(), {});
    expect(cfg.format).toBe('md');
    expect(cfg.quiet).toBe(false);
    expect(cfg.debug).toBe(false);

    const home = os.homedir();
    expect(cfg.storeDb).toBe(path.normalize(path.join(home, '.agent-remnote', 'store.sqlite')));
    expect(cfg.wsUrl).toBe('ws://localhost:6789/ws');
    expect(cfg.wsStateFile.disabled).toBe(false);
    expect(cfg.wsStateFile.path).toBe(path.normalize(path.join(home, '.agent-remnote', 'ws.bridge.state.json')));
    expect(cfg.wsDispatchMaxBytes).toBe(512_000);
    expect(cfg.wsDispatchMaxOpBytes).toBe(256_000);
  });

  it('prefers CLI values over env values', async () => {
    const cfg = await runWithProvider(new Map([['storeDb', '/tmp/cli-store.sqlite']]), {
      REMNOTE_STORE_DB: '/tmp/env-store.sqlite',
    });
    expect(cfg.storeDb).toBe(path.normalize('/tmp/cli-store.sqlite'));
  });

  it('falls back to env values when CLI is unset', async () => {
    const cfg = await runWithProvider(new Map(), { REMNOTE_STORE_DB: '/tmp/env-store.sqlite' });
    expect(cfg.storeDb).toBe(path.normalize('/tmp/env-store.sqlite'));
  });

  it('accepts legacy env REMNOTE_QUEUE_DB when store env is unset', async () => {
    const cfg = await runWithProvider(new Map(), { REMNOTE_QUEUE_DB: '/tmp/env-queue.sqlite' });
    expect(cfg.storeDb).toBe(path.normalize('/tmp/env-queue.sqlite'));
  });

  it('normalizes and expands user paths', async () => {
    const cfg = await runWithProvider(new Map([['storeDb', '~/tmp/store.sqlite']]), {});
    expect(cfg.storeDb).toBe(path.normalize(path.join(os.homedir(), 'tmp', 'store.sqlite')));
  });

  it('fails with stable error code when output format conflicts', async () => {
    const exit = await runExitWithProvider(
      new Map([
        ['json', 'true'],
        ['ids', 'true'],
      ]),
      {},
    );
    const error = unwrapCliError(exit);
    expect(error).toMatchObject({ _tag: 'CliError', code: 'INVALID_ARGS', exitCode: 2 });
  });

  it('fails with stable error code when wsPort is invalid', async () => {
    const exit = await runExitWithProvider(new Map([['wsPort', '70000']]), {});
    const error = unwrapCliError(exit);
    expect(error).toMatchObject({ _tag: 'CliError', code: 'INVALID_ARGS', exitCode: 2 });
  });

  it('supports disabling wsStateFile via env sentinel', async () => {
    const cfg = await runWithProvider(new Map(), { REMNOTE_WS_STATE_FILE: '0' });
    expect(cfg.wsStateFile.disabled).toBe(true);
  });

  it('supports disabling wsScheduler via env', async () => {
    const cfg = await runWithProvider(new Map(), { REMNOTE_WS_SCHEDULER: '0' });
    expect(cfg.wsScheduler).toBe(false);
  });

  it('supports ws dispatch budget via env', async () => {
    const cfg = await runWithProvider(new Map(), {
      REMNOTE_WS_DISPATCH_MAX_BYTES: '123456',
      REMNOTE_WS_DISPATCH_MAX_OP_BYTES: '4567',
    });
    expect(cfg.wsDispatchMaxBytes).toBe(123456);
    expect(cfg.wsDispatchMaxOpBytes).toBe(4567);
  });
});
