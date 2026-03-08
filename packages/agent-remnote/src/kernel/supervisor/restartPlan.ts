import type { SupervisorLastExit, SupervisorRestartConfig, SupervisorStateFile } from './model.js';

export type SupervisorRestartPlan =
  | { readonly _tag: 'restart'; readonly delayMs: number; readonly nextState: SupervisorStateFile }
  | { readonly _tag: 'failed'; readonly nextState: SupervisorStateFile };

function clampInt(value: number, min: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

function computeDelayMs(params: {
  readonly restartCount: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
}): number {
  const base = clampInt(params.baseBackoffMs, 1, 500);
  const max = clampInt(params.maxBackoffMs, 1, 10_000);
  const pow = Math.max(0, clampInt(params.restartCount, 0, 0) - 1);
  const factor = 2 ** Math.min(pow, 30);
  const raw = base * factor;
  return Math.min(max, Math.max(1, Math.floor(raw)));
}

export function initialSupervisorState(now: number): SupervisorStateFile {
  return {
    status: 'running',
    restart_count: 0,
    restart_window_started_at: now,
    backoff_until: null,
    last_exit: null,
    failed_reason: null,
  };
}

export function planRestart(params: {
  readonly now: number;
  readonly state: SupervisorStateFile;
  readonly lastExit: SupervisorLastExit;
  readonly config: SupervisorRestartConfig;
}): SupervisorRestartPlan {
  const maxRestarts = clampInt(params.config.maxRestarts, 0, 10);
  const restartWindowMs = clampInt(params.config.restartWindowMs, 1, 60_000);

  const windowExpired = params.now - params.state.restart_window_started_at >= restartWindowMs;
  const nextWindowStart = windowExpired ? params.now : params.state.restart_window_started_at;
  const nextRestartCount = (windowExpired ? 0 : params.state.restart_count) + 1;

  if (nextRestartCount > maxRestarts) {
    const nextState: SupervisorStateFile = {
      status: 'failed',
      restart_count: nextRestartCount,
      restart_window_started_at: nextWindowStart,
      backoff_until: null,
      last_exit: params.lastExit,
      failed_reason: `crash_loop_detected: restart_count=${nextRestartCount} window_ms=${restartWindowMs}`,
    };
    return { _tag: 'failed', nextState };
  }

  const delayMs = computeDelayMs({
    restartCount: nextRestartCount,
    baseBackoffMs: params.config.baseBackoffMs,
    maxBackoffMs: params.config.maxBackoffMs,
  });

  const nextState: SupervisorStateFile = {
    status: 'backing_off',
    restart_count: nextRestartCount,
    restart_window_started_at: nextWindowStart,
    backoff_until: params.now + delayMs,
    last_exit: params.lastExit,
    failed_reason: null,
  };

  return { _tag: 'restart', delayMs, nextState };
}
