import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as TestClock from 'effect/TestClock';
import * as TestContext from 'effect/TestContext';

import { WsClient, WsClientLive } from '../../src/services/WsClient.js';

const testClockLayer = TestClock.defaultTestClock.pipe(Layer.provide(TestContext.TestContext));

function unwrapCliError(exit: Exit.Exit<unknown, unknown>) {
  if (Exit.isSuccess(exit)) throw new Error('Expected failure exit');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('Expected failure cause');
  return failure.value as any;
}

async function startWsServer(params: {
  readonly onMessage?: (msg: any) => void;
}): Promise<{
  readonly url: string;
  readonly close: () => Promise<void>;
  readonly skipped: boolean;
  readonly connected: Promise<void>;
  readonly closed: Promise<void>;
}> {
  const server = createServer();

  const listenResult = await new Promise<{ ok: true } | { ok: false; error: unknown }>((resolve) => {
    const onError = (error: unknown) => resolve({ ok: false, error });
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve({ ok: true });
    });
  });

  if (!listenResult.ok) {
    const anyError = listenResult.error as any;
    if (anyError?.code === 'EPERM') {
      try {
        server.close();
      } catch {}
      return { url: '', skipped: true, close: async () => {}, connected: Promise.resolve(), closed: Promise.resolve() };
    }
    throw listenResult.error;
  }

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('error', () => {});

  let resolveConnected!: () => void;
  const connected = new Promise<void>((resolve) => {
    resolveConnected = resolve;
  });

  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  wss.on('connection', (ws) => {
    resolveConnected();
    ws.on('close', () => resolveClosed());
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data));
        params.onMessage?.(msg);
      } catch {
        // ignore
      }
    });
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const url = `ws://localhost:${port}/ws`;

  const close = async () => {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { url, close, skipped: false, connected, closed };
}

describe('WsClient (unit)', () => {
  it('times out and releases socket (TestClock)', async () => {
    const ws = await startWsServer({
      onMessage: () => {
        // Intentionally do not respond.
      },
    });
    if (ws.skipped) return;

    try {
      const exit = await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* WsClient;

          const fiber = yield* client.health({ url: ws.url, timeoutMs: 1000 }).pipe(Effect.fork);
          yield* Effect.promise(() => ws.connected);
          yield* TestClock.adjust(1001);
          return yield* Fiber.join(fiber).pipe(Effect.exit);
        })
          .pipe(Effect.provide(testClockLayer))
          .pipe(Effect.provide(WsClientLive)),
      );

      const error = unwrapCliError(exit);
      expect(error).toMatchObject({ _tag: 'CliError', code: 'WS_TIMEOUT', exitCode: 1 });

      await ws.closed;
    } finally {
      await ws.close();
    }
  });

  it('is interruptible and releases socket', async () => {
    const ws = await startWsServer({
      onMessage: () => {
        // Intentionally do not respond.
      },
    });
    if (ws.skipped) return;

    try {
      const interrupted = await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* WsClient;

          const fiber = yield* client.queryClients({ url: ws.url, timeoutMs: 60_000 }).pipe(Effect.fork);
          yield* Effect.promise(() => ws.connected);

          const exit = yield* Fiber.interrupt(fiber);
          return Exit.isInterrupted(exit);
        }).pipe(Effect.provide(WsClientLive)),
      );

      expect(interrupted).toBe(true);
      await ws.closed;
    } finally {
      await ws.close();
    }
  });
});
