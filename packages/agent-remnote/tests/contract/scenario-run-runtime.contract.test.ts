import { describe, expect, it } from 'vitest';

import {
  compileScenarioExecutionPlan,
  planScenarioExecution,
  resolveScenarioExecutionPlan,
} from '../../src/lib/scenario-runtime/index.js';
import { getBuiltinScenarioPackage } from '../../src/lib/builtin-scenarios/index.js';

const dnRecentTodosToTodayMovePackage = getBuiltinScenarioPackage('dn_recent_todos_to_today_move');
const dnRecentTodosToTodayPortalPackage = getBuiltinScenarioPackage('dn_recent_todos_to_today_portal');

describe('contract: scenario run runtime', () => {
  it('binds builtin move vars into runtime-ready query scope and lowers to apply_actions', async () => {
    const planned = planScenarioExecution({
      scenarioPackage: dnRecentTodosToTodayMovePackage,
      vars: {},
    });

    expect(planned.phase).toBe('planned');
    expect(planned.selector_plan[0]?.query.scope).toEqual({
      kind: 'daily_range',
      from_offset_days: -7,
      to_offset_days: -1,
    });

    const resolved = await resolveScenarioExecutionPlan(planned, {
      runQuery: async () => ({
        items: [{ rem_id: 'R1' }, { rem_id: 'R2' }],
        total_selected: 2,
        truncated: false,
      }),
    });

    expect(resolved.phase).toBe('resolved');
    expect(resolved.selection_sets.recent_todos?.items).toEqual([{ rem_id: 'R1' }, { rem_id: 'R2' }]);

    const compiled = compileScenarioExecutionPlan(resolved);
    expect(compiled.phase).toBe('compiled');
    expect(compiled.compiled_execution).toMatchObject({
      kind: 'apply_actions',
      envelope: {
        version: 1,
        kind: 'actions',
      },
    });
    expect(compiled.compiled_execution?.kind).toBe('apply_actions');
    expect((compiled.compiled_execution as any).envelope.actions).toEqual([
      {
        action: 'rem.moveMany',
        input: {
          rem_ids: ['R1', 'R2'],
          new_parent_id: 'daily:today',
        },
      },
    ]);
  });

  it('lowers builtin portal mode to apply_actions with parent refs preserved', async () => {
    const planned = planScenarioExecution({
      scenarioPackage: dnRecentTodosToTodayPortalPackage,
      vars: { target_ref: 'daily:2026-03-23' },
    });
    const resolved = await resolveScenarioExecutionPlan(planned, {
      runQuery: async () => ({
        items: [{ rem_id: 'R10' }],
        total_selected: 1,
        truncated: false,
      }),
    });
    const compiled = compileScenarioExecutionPlan(resolved);

    expect(compiled.compiled_execution).toMatchObject({
      kind: 'apply_actions',
      envelope: {
        version: 1,
        kind: 'actions',
        actions: [
          {
            action: 'portal.create',
            input: {
              parent_id: 'daily:2026-03-23',
              target_rem_id: 'R10',
            },
          },
        ],
      },
    });
  });

  it('fails fast when source_scope cannot be normalized into a runtime-ready scope', () => {
    expect(() =>
      planScenarioExecution({
        scenarioPackage: dnRecentTodosToTodayMovePackage,
        vars: { source_scope: 'daily:typo-range' },
      }),
    ).toThrow(/Unsupported scenario scope value/);
  });

  it('rejects the retired daily:previous-* scope spelling', () => {
    expect(() =>
      planScenarioExecution({
        scenarioPackage: dnRecentTodosToTodayMovePackage,
        vars: { source_scope: 'daily:previous-7d' },
      }),
    ).toThrow(/Unsupported scenario scope value/);
  });

  it('carries scheduling hints from the package into planned and compiled execution', async () => {
    const planned = planScenarioExecution({
      scenarioPackage: {
        ...dnRecentTodosToTodayMovePackage,
        scheduling: {
          batching: 'auto',
          merge_strategy: 'safe_dedupe',
          parallelism: 'auto',
          ordering: 'preserve_selection_order',
          dispatch_mode: 'conflict_parallel',
        },
      },
      vars: {},
    });

    expect(planned.scheduling).toEqual({
      batching: 'auto',
      merge_strategy: 'safe_dedupe',
      parallelism: 'auto',
      ordering: 'preserve_selection_order',
      dispatch_mode: 'conflict_parallel',
    });

    const resolved = await resolveScenarioExecutionPlan(planned, {
      runQuery: async () => ({
        items: [{ rem_id: 'R1' }, { rem_id: 'R2' }],
        total_selected: 2,
        truncated: false,
      }),
    });
    const compiled = compileScenarioExecutionPlan(resolved);

    expect(compiled.scheduling).toEqual(planned.scheduling);
  });
});
