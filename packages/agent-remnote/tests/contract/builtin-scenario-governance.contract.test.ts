import { describe, expect, it } from 'vitest';

import { builtinScenarioCatalog, builtinScenarioPackages } from '../../src/lib/builtin-scenarios/index.js';

describe('contract: builtin scenario governance', () => {
  it('keeps builtin ids stable, unique, and collision-free', () => {
    const ids = builtinScenarioCatalog.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9_]+$/.test(id))).toBe(true);
    expect(ids.every((id) => id.startsWith('dn_recent_todos_to_today_'))).toBe(true);
  });

  it('keeps catalog entries traceable to canonical packages', () => {
    for (const entry of builtinScenarioCatalog) {
      const pkg = builtinScenarioPackages[entry.package_id as keyof typeof builtinScenarioPackages];
      expect(pkg).toBeDefined();
      expect(entry.package_path.endsWith('.json')).toBe(true);
      expect(entry.package_path).toContain('packages/agent-remnote/builtin-scenarios/packages/');
      expect(entry.package_id).toBe(pkg.id);
      expect(entry.package_version).toBe(pkg.version);
      expect(entry.owner).toBe(pkg.meta.owner);
      expect(entry.remote_parity_required).toBe(pkg.policy.remote_parity_required);
      expect(entry.review_status).toBe('planned_namespace_pending_promotion');
    }
  });
});
