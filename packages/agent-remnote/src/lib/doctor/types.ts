export type DoctorCheckId =
  | 'runtime.stale_pid_or_state'
  | 'runtime.version_mismatch'
  | 'config.migration_needed'
  | 'package.builtin_scenarios_broken'
  | 'package.plugin_artifacts_unavailable'
  | 'env.path_or_permission_problem';

export type DoctorSeverity = 'info' | 'warning' | 'error';

export type DoctorCheck = {
  readonly id: DoctorCheckId;
  readonly ok: boolean;
  readonly severity: DoctorSeverity;
  readonly summary: string;
  readonly details?: unknown;
  readonly repairable: boolean;
  readonly fixed?: boolean;
};

export type DoctorFixId =
  | 'runtime.cleanup_stale_artifacts'
  | 'runtime.restart_mismatched_services'
  | 'config.rewrite_canonical_user_config';

export type DoctorFix = {
  readonly id: DoctorFixId;
  readonly ok: boolean;
  readonly changed: boolean;
  readonly summary: string;
  readonly details?: unknown;
};

export type DoctorRestartSummary = {
  readonly attempted: readonly string[];
  readonly restarted: readonly string[];
  readonly skipped: readonly string[];
  readonly failed: readonly { readonly service: string; readonly error: string }[];
};
