import * as Effect from 'effect/Effect';

import {
  normalizeScenarioPackage,
  type ScenarioDiagnostic,
  type ScenarioPackage,
  type ScenarioSchedulingPolicy,
} from '../scenario-shared/index.js';
import { CliError } from '../../services/Errors.js';

export type ScenarioSelectionSet = {
  readonly items: readonly { readonly rem_id: string }[];
  readonly total_selected: number;
  readonly truncated: boolean;
  readonly source_nodes: readonly string[];
  readonly lineage: readonly string[];
  readonly warnings?: readonly string[];
};

export type ScenarioExecutionPlan = {
  readonly version: 1;
  readonly source_package: {
    readonly id: string;
    readonly version: number;
  };
  readonly phase: 'planned' | 'resolved' | 'compiled';
  readonly vars_bound: Readonly<Record<string, unknown>>;
  readonly selector_plan: readonly {
    readonly node_id: string;
    readonly selector_kind: 'query' | 'preset_ref';
    readonly query: Record<string, unknown>;
  }[];
  readonly selection_sets: Readonly<Record<string, ScenarioSelectionSet>>;
  readonly transform_plan: readonly unknown[];
  readonly action_plan: readonly {
    readonly node_id: string;
    readonly command_id: string;
    readonly input: Record<string, unknown>;
    readonly depends_on: readonly string[];
  }[];
  readonly scheduling?: ScenarioSchedulingPolicy;
  readonly compiled_execution?: {
    readonly kind: 'apply_actions' | 'business_command';
    readonly envelope?: Record<string, unknown>;
    readonly command_id?: string;
    readonly input?: Record<string, unknown>;
  };
  readonly diagnostics: readonly (ScenarioDiagnostic & { readonly code?: string })[];
};

type QueryRunner = (params: {
  readonly query: Record<string, unknown>;
  readonly limit?: number;
}) => Promise<{
  readonly items: readonly { readonly rem_id: string }[];
  readonly total_selected: number;
  readonly truncated: boolean;
}>;

type ApplySubmitter = (params: {
  readonly envelope: Record<string, unknown>;
}) => Promise<unknown>;

type ExecuteScenarioRunParams = {
  readonly scenarioPackage: unknown;
  readonly vars: Record<string, unknown>;
  readonly dryRun: boolean;
};

type ExecuteScenarioRunDeps = {
  readonly runQuery: QueryRunner;
  readonly submitApply?: ApplySubmitter;
};

function parseScopeSpec(raw: unknown): Record<string, unknown> {
  const value = String(raw ?? '').trim();
  if (!value) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: 'Scenario scope variable resolved to an empty value',
      exitCode: 2,
    });
  }
  const match = /^daily:last-(\d+)d$/i.exec(value);
  if (match) {
    const days = Math.max(1, Number(match[1]));
    return {
      kind: 'daily_range',
      from_offset_days: -(days - 1),
      to_offset_days: 0,
    };
  }
  const pastMatch = /^daily:past-(\d+)d$/i.exec(value);
  if (pastMatch) {
    const days = Math.max(1, Number(pastMatch[1]));
    return {
      kind: 'daily_range',
      from_offset_days: -days,
      to_offset_days: -1,
    };
  }
  if (value === 'all') return { kind: 'all' };
  throw new CliError({
    code: 'INVALID_ARGS',
    message: `Unsupported scenario scope value: ${value}`,
    exitCode: 2,
  });
}

function bindVars(pkg: ScenarioPackage, vars: Record<string, unknown>): Record<string, unknown> {
  const bound: Record<string, unknown> = {};
  for (const variable of pkg.vars) {
    if (Object.prototype.hasOwnProperty.call(vars, variable.name)) {
      bound[variable.name] = vars[variable.name];
      continue;
    }
    if (variable.default !== undefined) {
      bound[variable.name] = variable.default;
      continue;
    }
    bound[variable.name] = null;
  }
  return bound;
}

function resolveStructuredInput(value: unknown, varsBound: Record<string, unknown>): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record.kind === 'var' && typeof record.name === 'string') {
    return varsBound[record.name];
  }
  if (record.kind === 'literal') {
    return record.value;
  }
  return value;
}

function diagnosticsWithCode(
  diagnostics: readonly ScenarioDiagnostic[],
  extra: readonly (ScenarioDiagnostic & { readonly code?: string })[] = [],
) {
  return [...diagnostics.map((item) => ({ ...item })), ...extra];
}

export function planScenarioExecution(params: {
  readonly scenarioPackage: unknown;
  readonly vars: Record<string, unknown>;
}): ScenarioExecutionPlan {
  const normalized = normalizeScenarioPackage(params.scenarioPackage);
  if (!normalized.ok) {
    throw new Error(normalized.errors.join('; '));
  }

  const varsBound = bindVars(normalized.package, params.vars);
  const selectorPlan = normalized.package.nodes
    .filter((node): node is Extract<ScenarioPackage['nodes'][number], { kind: 'selector' }> => node.kind === 'selector')
    .map((node) => {
      const query = structuredClone((node.input.query ?? {}) as Record<string, unknown>);
      if (
        query.scope &&
        typeof query.scope === 'object' &&
        !Array.isArray(query.scope) &&
        (query.scope as any).kind === 'var' &&
        typeof (query.scope as any).name === 'string'
      ) {
        query.scope = parseScopeSpec(varsBound[String((query.scope as any).name)]);
      }
      return {
        node_id: node.id,
        selector_kind: node.selector_kind,
        query,
      };
    });

  const actionPlan = normalized.package.nodes
    .filter((node): node is Extract<ScenarioPackage['nodes'][number], { kind: 'action' }> => node.kind === 'action')
    .map((node) => ({
      node_id: node.id,
      command_id: node.command_id,
      input: node.input,
      depends_on: node.depends_on ?? [],
    }));

  return {
    version: 1,
    source_package: {
      id: normalized.package.id,
      version: normalized.package.version,
    },
    phase: 'planned',
    vars_bound: varsBound,
    selector_plan: selectorPlan,
    selection_sets: {},
    transform_plan: [],
    action_plan: actionPlan,
    ...(normalized.package.scheduling ? { scheduling: normalized.package.scheduling } : {}),
    diagnostics: diagnosticsWithCode(normalized.diagnostics),
  };
}

export async function resolveScenarioExecutionPlan(
  plan: ScenarioExecutionPlan,
  deps: {
    readonly runQuery: QueryRunner;
  },
): Promise<ScenarioExecutionPlan> {
  const selectionSets: Record<string, ScenarioSelectionSet> = {};

  for (const selector of plan.selector_plan) {
    const result = await deps.runQuery({
      query: selector.query,
    });
    selectionSets[selector.node_id] = {
      items: result.items,
      total_selected: result.total_selected,
      truncated: result.truncated,
      source_nodes: [selector.node_id],
      lineage: [`selector:${selector.node_id}`],
    };
  }

  return {
    ...plan,
    phase: 'resolved',
    selection_sets: selectionSets,
  };
}

function compileActions(
  plan: ScenarioExecutionPlan,
): {
  readonly compiledExecution?: ScenarioExecutionPlan['compiled_execution'];
  readonly diagnostics: readonly (ScenarioDiagnostic & { readonly code?: string })[];
} {
  const actions: Array<{ action: string; input: Record<string, unknown> }> = [];
  const diagnostics: Array<ScenarioDiagnostic & { readonly code?: string }> = [];

  for (const actionNode of plan.action_plan) {
    const selectionInput = actionNode.input.selection as Record<string, unknown> | undefined;
    const selectionNodeId =
      selectionInput && selectionInput.kind === 'node_output' && typeof selectionInput.node === 'string'
        ? selectionInput.node
        : '';
    const selection = selectionNodeId ? plan.selection_sets[selectionNodeId] : undefined;
    const targetRef = resolveStructuredInput(actionNode.input.target_ref, plan.vars_bound);
    const targetValue = typeof targetRef === 'string' ? targetRef : String(targetRef ?? '');

    if (!selection || selection.items.length === 0) {
      diagnostics.push({
        level: 'info',
        path: `action_plan.${actionNode.node_id}`,
        message: `Selection for ${actionNode.node_id} is empty, skipping apply lowering`,
        code: 'empty_selection_skipped',
      });
      continue;
    }

    if (actionNode.command_id === 'rem.move') {
      if (selection.items.length >= 2) {
        actions.push({
          action: 'rem.moveMany',
          input: {
            rem_ids: selection.items.map((item) => item.rem_id),
            new_parent_id: targetValue,
          },
        });
      } else {
        actions.push({
          action: 'rem.move',
          input: {
            rem_id: selection.items[0]!.rem_id,
            new_parent_id: targetValue,
          },
        });
      }
      continue;
    }

    if (actionNode.command_id === 'portal.create') {
      if (selection.items.length >= 2) {
        actions.push({
          action: 'portal.createMany',
          input: {
            parent_id: targetValue,
            items: selection.items.map((item) => ({
              target_rem_id: item.rem_id,
            })),
          },
        });
      } else {
        actions.push({
          action: 'portal.create',
          input: {
            parent_id: targetValue,
            target_rem_id: selection.items[0]!.rem_id,
          },
        });
      }
      continue;
    }

    diagnostics.push({
      level: 'error',
      path: `action_plan.${actionNode.node_id}`,
      message: `Unsupported command_id for scenario lowering: ${actionNode.command_id}`,
      code: 'unsupported_command',
    });
  }

  if (actions.length === 0) {
    return { diagnostics };
  }

  return {
    compiledExecution: {
      kind: 'apply_actions',
      envelope: {
        version: 1,
        kind: 'actions',
        actions,
      },
    },
    diagnostics,
  };
}

export function compileScenarioExecutionPlan(plan: ScenarioExecutionPlan): ScenarioExecutionPlan {
  const compiled = compileActions(plan);
  return {
    ...plan,
    phase: compiled.compiledExecution ? 'compiled' : 'resolved',
    ...(compiled.compiledExecution ? { compiled_execution: compiled.compiledExecution } : {}),
    diagnostics: diagnosticsWithCode(plan.diagnostics, compiled.diagnostics),
  };
}

export async function executeScenarioRun(
  params: ExecuteScenarioRunParams,
  deps: ExecuteScenarioRunDeps,
): Promise<{
  readonly phase: ScenarioExecutionPlan['phase'];
  readonly plan: ScenarioExecutionPlan;
  readonly submission: unknown | null;
}> {
  const normalized = normalizeScenarioPackage(params.scenarioPackage);
  if (!normalized.ok) {
    throw new CliError({
      code: 'INVALID_PAYLOAD',
      message: normalized.errors.join('; '),
      exitCode: 2,
    });
  }
  const fallbackStrategy = normalized.package.policy.fallback_strategy ?? 'fail';
  const planned = planScenarioExecution(params);
  const resolved = await resolveScenarioExecutionPlan(planned, { runQuery: deps.runQuery });
  const totalSelected = Object.values(resolved.selection_sets).reduce(
    (sum, selection) => sum + Number(selection?.items?.length ?? 0),
    0,
  );

  if (totalSelected === 0) {
    if (fallbackStrategy === 'fail') {
      throw new CliError({
        code: 'INVALID_ARGS',
        message: 'Scenario selection is empty and fallback_strategy=fail',
        exitCode: 2,
      });
    }

    const code = fallbackStrategy === 'skip_optional_outputs' ? 'optional_outputs_skipped' : 'empty_selection_skipped';
    const message =
      fallbackStrategy === 'skip_optional_outputs'
        ? 'Selection is empty, skipping optional outputs'
        : 'Selection is empty, skipping scenario submission';
    return {
      phase: resolved.phase,
      plan: {
        ...resolved,
        diagnostics: diagnosticsWithCode(resolved.diagnostics, [
          {
            level: 'info',
            path: 'selection_sets',
            message,
            code,
          },
        ]),
      },
      submission: null,
    };
  }

  const compiled = compileScenarioExecutionPlan(resolved);

  if (params.dryRun || !compiled.compiled_execution || compiled.compiled_execution.kind !== 'apply_actions') {
    return {
      phase: compiled.phase,
      plan: compiled,
      submission: null,
    };
  }

  if (!deps.submitApply) {
    throw new Error('submitApply is required when dryRun=false and compiled execution is present');
  }

  const submission = await deps.submitApply({
    envelope: compiled.compiled_execution.envelope ?? {},
  });
  return {
    phase: compiled.phase,
    plan: compiled,
    submission,
  };
}

export function runScenarioPackageEffect(params: ExecuteScenarioRunParams & ExecuteScenarioRunDeps) {
  return Effect.promise(() => executeScenarioRun(params, params));
}
