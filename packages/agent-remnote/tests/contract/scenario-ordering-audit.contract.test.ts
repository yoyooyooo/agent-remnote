import { describe, expect, it } from 'vitest';

import {
  compileScenarioExecutionPlan,
  planScenarioExecution,
  resolveScenarioExecutionPlan,
} from '../../src/lib/scenario-runtime/index.js';
import { getBuiltinScenarioPackage } from '../../src/lib/builtin-scenarios/index.js';

const dnRecentTodosToTodayPortalPackage = getBuiltinScenarioPackage('dn_recent_todos_to_today_portal');

describe('contract: scenario ordering audit', () => {
  it('preserves selection order when lowering apply_actions', async () => {
    const planned = planScenarioExecution({
      scenarioPackage: dnRecentTodosToTodayPortalPackage,
      vars: { target_ref: 'daily:today' },
    });
    const resolved = await resolveScenarioExecutionPlan(planned, {
      runQuery: async () => ({
        items: [{ rem_id: 'R3' }, { rem_id: 'R1' }, { rem_id: 'R2' }],
        total_selected: 3,
        truncated: false,
      }),
    });
    const compiled = compileScenarioExecutionPlan(resolved);

    expect(compiled.compiled_execution?.kind).toBe('apply_actions');
    expect((compiled.compiled_execution as any).envelope.actions).toEqual([
      {
        action: 'portal.createMany',
        input: {
          parent_id: 'daily:today',
          items: [{ target_rem_id: 'R3' }, { target_rem_id: 'R1' }, { target_rem_id: 'R2' }],
        },
      },
    ]);
  });

  it('never lowers scenario execution to raw ops', async () => {
    const planned = planScenarioExecution({
      scenarioPackage: dnRecentTodosToTodayPortalPackage,
      vars: { target_ref: 'daily:today' },
    });
    const resolved = await resolveScenarioExecutionPlan(planned, {
      runQuery: async () => ({
        items: [{ rem_id: 'R1' }],
        total_selected: 1,
        truncated: false,
      }),
    });
    const compiled = compileScenarioExecutionPlan(resolved);

    expect(compiled.compiled_execution?.kind).toMatch(/^(apply_actions|business_command)$/);
    expect((compiled.compiled_execution as any).ops).toBeUndefined();
  });
});
