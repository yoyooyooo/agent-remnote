import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  builtinScenarioCatalog,
  builtinScenarioPackages,
  getBuiltinScenarioPackage,
} from '../../src/lib/builtin-scenarios/index.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const SOURCE_DIR = path.join(REPO_ROOT, 'packages/agent-remnote/builtin-scenarios');

function readSourceJson(relPath: string): unknown {
  return JSON.parse(readFileSync(path.join(SOURCE_DIR, relPath), 'utf8'));
}

describe('contract: builtin scenario catalog', () => {
  it('keeps builtin scenario catalog aligned with the repo json source', () => {
    expect(builtinScenarioCatalog).toEqual(readSourceJson('catalog.json'));
  });

  it('keeps dn_recent_todos_to_today move package aligned with the repo json source', () => {
    expect(getBuiltinScenarioPackage('dn_recent_todos_to_today_move')).toEqual(
      readSourceJson('packages/dn_recent_todos_to_today_move.json'),
    );
  });

  it('keeps dn_recent_todos_to_today portal package aligned with the repo json source', () => {
    expect(getBuiltinScenarioPackage('dn_recent_todos_to_today_portal')).toEqual(
      readSourceJson('packages/dn_recent_todos_to_today_portal.json'),
    );
  });

  it('exposes both move and portal variants with explicit vars and stable command targets', () => {
    expect(Object.keys(builtinScenarioPackages).sort()).toEqual([
      'dn_recent_todos_to_today_move',
      'dn_recent_todos_to_today_portal',
    ]);

    for (const pkg of Object.values(builtinScenarioPackages)) {
      const selectorNode = pkg.nodes[0];
      const actionNode = pkg.nodes[1];
      expect(Array.isArray(pkg.vars)).toBe(true);
      expect(pkg.vars.map((item: any) => item.name)).toEqual(['source_scope', 'target_ref']);
      expect(pkg.policy.remote_parity_required).toBe(true);
      expect(selectorNode?.kind).toBe('selector');
      if (selectorNode?.kind === 'selector') {
        const query = selectorNode.input.query as any;
        expect(selectorNode.selector_kind).toBe('query');
        expect(query?.root?.powerup?.by).toBe('rcrt');
        expect(query?.root?.powerup?.value).toBe('t');
      }
      expect(actionNode?.kind).toBe('action');
      if (actionNode?.kind === 'action') {
        expect(['rem.move', 'portal.create']).toContain(actionNode.command_id);
      }
    }

    expect((builtinScenarioPackages.dn_recent_todos_to_today_move.nodes[1] as any)?.command_id).toBe('rem.move');
    expect((builtinScenarioPackages.dn_recent_todos_to_today_portal.nodes[1] as any)?.command_id).toBe('portal.create');
  });
});
