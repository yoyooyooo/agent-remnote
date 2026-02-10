export type SupervisorLastExit = {
  readonly at: number;
  readonly code: number | null;
  readonly signal: string | null;
  readonly reason: string | null;
};

export type SupervisorStatus = 'running' | 'backing_off' | 'failed' | 'stopping';

export type SupervisorStateFile = {
  readonly status: SupervisorStatus;
  readonly restart_count: number;
  readonly restart_window_started_at: number;
  readonly backoff_until: number | null;
  readonly last_exit: SupervisorLastExit | null;
  readonly failed_reason: string | null;
};

export type SupervisorRestartConfig = {
  readonly maxRestarts: number;
  readonly restartWindowMs: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
};

