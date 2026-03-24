import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const BENCH_DIR = path.join(
  REPO_ROOT,
  'specs/031-query-scenario-package-and-command-taxonomy/benchmark',
);

function readJson(name: string): any {
  return JSON.parse(readFileSync(path.join(BENCH_DIR, name), 'utf8'));
}

describe('contract: scenario benchmark gate', () => {
  it('freezes fixture, baseline, and threshold metadata for the 031 pilot benchmark', () => {
    const fixture = readJson('scenario-benchmark-fixture.json');
    const baseline = readJson('performance-baseline.json');
    const threshold = readJson('performance-threshold.json');

    expect(fixture.schema_version).toBe(1);
    expect(baseline.schema_version).toBe(1);
    expect(threshold.schema_version).toBe(1);

    expect(fixture.fixture_id).toBe('dn_recent_todos_to_today_portal_small');
    expect(baseline.fixture_id).toBe(fixture.fixture_id);
    expect(threshold.fixture_id).toBe(fixture.fixture_id);

    expect(fixture.metrics).toEqual(['compiled_action_count', 'queue_ops_enqueued', 'wall_clock_ms']);
    expect(Object.keys(baseline.baseline)).toEqual(fixture.metrics);
    expect(Object.keys(threshold.threshold)).toEqual(fixture.metrics);
    expect(baseline.sampling).toMatchObject({ warmup_runs: 1, runs: 5 });
  });
});
