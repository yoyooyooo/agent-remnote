import { describe, expect, it } from 'vitest';

import { executeScenarioRun } from '../../src/lib/scenario-runtime/index.js';
import { getBuiltinScenarioPackage } from '../../src/lib/builtin-scenarios/index.js';

const dnRecentTodosToTodayMovePackage = getBuiltinScenarioPackage('dn_recent_todos_to_today_move');

describe('integration: scenario run runtime', () => {
  it('skips apply submission when fallback_strategy allows empty selections', async () => {
    let applyCalls = 0;
    const result = await executeScenarioRun(
      {
        scenarioPackage: dnRecentTodosToTodayMovePackage,
        vars: {},
        dryRun: false,
      },
      {
        runQuery: async () => ({
          items: [],
          total_selected: 0,
          truncated: false,
        }),
        submitApply: async () => {
          applyCalls += 1;
          return { txn_id: 'unexpected' };
        },
      },
    );

    expect(result.phase).toBe('resolved');
    expect(result.submission).toBeNull();
    expect(result.plan.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'empty_selection_skipped' })]),
    );
    expect(applyCalls).toBe(0);
  });

  it('fails when fallback_strategy=fail and the selection is empty', async () => {
    await expect(
      executeScenarioRun(
        {
          scenarioPackage: {
            ...dnRecentTodosToTodayMovePackage,
            policy: {
              ...dnRecentTodosToTodayMovePackage.policy,
              fallback_strategy: 'fail',
            },
          },
          vars: {},
          dryRun: false,
        },
        {
          runQuery: async () => ({
            items: [],
            total_selected: 0,
            truncated: false,
          }),
          submitApply: async () => ({ txn_id: 'unexpected' }),
        },
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGS',
      message: 'Scenario selection is empty and fallback_strategy=fail',
    });
  });

  it('skips optional outputs when fallback_strategy=skip_optional_outputs and the selection is empty', async () => {
    const result = await executeScenarioRun(
      {
        scenarioPackage: {
          ...dnRecentTodosToTodayMovePackage,
          policy: {
            ...dnRecentTodosToTodayMovePackage.policy,
            fallback_strategy: 'skip_optional_outputs',
          },
        },
        vars: {},
        dryRun: false,
      },
      {
        runQuery: async () => ({
          items: [],
          total_selected: 0,
          truncated: false,
        }),
        submitApply: async () => ({ txn_id: 'unexpected' }),
      },
    );

    expect(result.phase).toBe('resolved');
    expect(result.submission).toBeNull();
    expect(result.plan.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'optional_outputs_skipped' })]),
    );
  });
});
