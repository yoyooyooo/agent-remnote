import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import * as Effect from 'effect/Effect';

import { getBuiltinScenarioPackage } from '../../src/lib/builtin-scenarios/index.js';
import {
  compileScenarioExecutionPlan,
  planScenarioExecution,
  resolveScenarioExecutionPlan,
} from '../../src/lib/scenario-runtime/index.js';
import { Payload } from '../../src/services/Payload.js';
import { compileApplyEnvelope, parseApplyEnvelope } from '../../src/commands/_applyEnvelope.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const BENCH_DIR = path.join(REPO_ROOT, 'specs/031-query-scenario-package-and-command-taxonomy/benchmark');

function readJson(name: string): any {
  return JSON.parse(readFileSync(path.join(BENCH_DIR, name), 'utf8'));
}

async function compileFixtureForSelectionSize(selectionSize: number): Promise<{
  readonly compiled_action_count: number;
  readonly queue_ops_enqueued: number;
  readonly wall_clock_ms: number;
}> {
  const fixture = readJson('scenario-benchmark-fixture.json');
  const scenarioPackage = getBuiltinScenarioPackage(fixture.package_id);
  const items = Array.from({ length: selectionSize }, (_, index) => ({ rem_id: `RID-${index + 1}` }));

  const startedAt = Date.now();
  const planned = planScenarioExecution({
    scenarioPackage,
    vars: {
      ...fixture.vars,
      target_ref: 'parent-1',
    },
  });
  const resolved = await resolveScenarioExecutionPlan(planned, {
    runQuery: async () => ({
      items,
      total_selected: items.length,
      truncated: false,
    }),
  });
  const compiled = compileScenarioExecutionPlan(resolved);

  const compiled_action_count = Array.isArray((compiled.compiled_execution as any)?.envelope?.actions)
    ? (compiled.compiled_execution as any).envelope.actions.length
    : 0;

  let queue_ops_enqueued = 0;
  if (compiled.compiled_execution?.kind === 'apply_actions') {
    const parsed = parseApplyEnvelope(compiled.compiled_execution.envelope ?? {});
    const compiledEnvelope: any = await Effect.runPromise(
      compileApplyEnvelope(parsed).pipe(
        Effect.provideService(Payload, {
          normalizeKeys: (value: unknown) => value,
          readJson: () => Effect.fail(new Error('unexpected readJson')),
        } as any),
      ) as any,
    );
    queue_ops_enqueued = compiledEnvelope.ops.length;
  }

  return {
    compiled_action_count,
    queue_ops_enqueued,
    wall_clock_ms: Date.now() - startedAt,
  };
}

describe('contract: scenario bulk throughput smoke', () => {
  it('keeps the 031 pilot scenario within the frozen bulk-first thresholds', async () => {
    const fixture = readJson('scenario-benchmark-fixture.json');
    const baseline = readJson('performance-baseline.json');
    const threshold = readJson('performance-threshold.json');

    const selectionSize = Math.max(...fixture.selection_sizes);
    const metrics = await compileFixtureForSelectionSize(selectionSize);

    expect(metrics.compiled_action_count).toBeLessThanOrEqual(
      baseline.baseline.compiled_action_count + threshold.threshold.compiled_action_count.max_absolute_delta,
    );
    expect(metrics.queue_ops_enqueued).toBeLessThanOrEqual(
      baseline.baseline.queue_ops_enqueued + threshold.threshold.queue_ops_enqueued.max_absolute_delta,
    );
    expect(metrics.wall_clock_ms).toBeLessThanOrEqual(
      Math.max(
        Math.ceil(baseline.baseline.wall_clock_ms * threshold.threshold.wall_clock_ms.max_ratio),
        baseline.baseline.wall_clock_ms + threshold.threshold.wall_clock_ms.max_absolute_delta,
      ),
    );
  });
});
