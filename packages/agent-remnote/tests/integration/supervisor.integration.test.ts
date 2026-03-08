import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';

import { runSupervisorRuntime } from '../../src/runtime/supervisor/runSupervisorRuntime.js';
import { AppConfig } from '../../src/services/AppConfig.js';
import type { ResolvedConfig } from '../../src/services/Config.js';
import { ChildProcessLive } from '../../src/services/ChildProcess.js';
import { DaemonFilesLive } from '../../src/services/DaemonFiles.js';
import { LogWriterFactoryLive } from '../../src/services/LogWriter.js';
import { SupervisorStateLive } from '../../src/services/SupervisorState.js';

function makeTestConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
  const wsScheduler = overrides?.wsScheduler ?? true;
  return {
    format: 'md',
    quiet: true,
    debug: false,
    remnoteDb: undefined,
    storeDb: '/tmp/store.sqlite',
    wsUrl: 'ws://localhost:0/ws',
    repo: undefined,
    wsStateFile: { disabled: true, path: '/tmp/ws.bridge.state.json' },
    wsStateStaleMs: 60_000,
    tmuxRefresh: false,
    tmuxRefreshMinIntervalMs: 250,
    statusLineFile: '/tmp/status-line.txt',
    statusLineMinIntervalMs: 1000,
    statusLineDebug: false,
    statusLineJsonFile: '/tmp/status-line.json',
    wsDispatchMaxBytes: 512_000,
    wsDispatchMaxOpBytes: 256_000,
    ...overrides,
    wsScheduler,
  };
}

async function readJsonFile(filePath: string): Promise<any> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

describe('SupervisorRuntime (integration)', () => {
  it('writes pid/state files and stops cleanly on SIGTERM', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agent-remnote-supervisor-'));
    const pidFilePath = path.join(tmpDir, 'ws.pid');
    const logFilePath = path.join(tmpDir, 'ws.log');
    const stateFilePath = path.join(tmpDir, 'ws.state.json');

    const cfgLayer = Layer.succeed(AppConfig, makeTestConfig({ wsUrl: 'ws://localhost:0/ws' }));
    const envLayer = Layer.mergeAll(
      cfgLayer,
      DaemonFilesLive,
      SupervisorStateLive,
      LogWriterFactoryLive,
      ChildProcessLive,
    );

    try {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fiber = yield* runSupervisorRuntime({
              pidFilePath,
              logFilePath,
              stateFilePath,
              logWriter: { maxBytes: 0, keep: 5 },
              restart: { maxRestarts: 1, restartWindowMs: 1000, baseBackoffMs: 50, maxBackoffMs: 50 },
              child: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], env: process.env },
            }).pipe(Effect.fork);

            yield* Effect.promise(() =>
              waitFor(async () => {
                try {
                  const pid = await readJsonFile(pidFilePath);
                  return typeof pid?.child_pid === 'number' && pid.child_pid > 0;
                } catch {
                  return false;
                }
              }, 5000),
            );

            const pidInfo = yield* Effect.promise(() => readJsonFile(pidFilePath));
            const state = yield* Effect.promise(() => readJsonFile(stateFilePath));

            yield* Effect.sync(() => process.emit('SIGTERM', 'SIGTERM'));
            yield* Fiber.join(fiber);

            const pidInfoAfter = yield* Effect.promise(() => readJsonFile(pidFilePath));
            const stateAfter = yield* Effect.promise(() => readJsonFile(stateFilePath));

            return { pidInfo, state, pidInfoAfter, stateAfter };
          }).pipe(Effect.provide(envLayer)),
        ),
      );

      const supervisorPid = Number(result.pidInfo?.pid ?? 0);
      const childPid = Number(result.pidInfo?.child_pid ?? 0);
      expect(result.pidInfo.mode).toBe('supervisor');
      expect(supervisorPid).toBe(process.pid);
      expect(childPid).toBeGreaterThan(0);
      expect(result.pidInfo.state_file).toBe(stateFilePath);
      expect(result.state.status).toBe('running');
      expect(result.pidInfoAfter.child_pid).toBeNull();
      expect(result.stateAfter.status).toBe('stopping');
    } finally {
      try {
        process.removeAllListeners('SIGTERM');
        process.removeAllListeners('SIGINT');
      } catch {}
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 20_000);
});
