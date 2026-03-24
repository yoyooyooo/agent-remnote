import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { remnoteCommandInventory } from '../../src/lib/business-semantics/commandInventory.js';
import { wave1RemnoteBusinessCommandVerificationCases } from '../helpers/remnoteBusinessCommandMatrix.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

function readRepoFile(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

describe('contract: scenario inventory and verification registry drift', () => {
  it('keeps scenario family out of current inventory and executable verification registry before promotion', () => {
    const inventoryIds = remnoteCommandInventory.map((entry) => entry.id);
    const verificationIds = Object.keys(wave1RemnoteBusinessCommandVerificationCases);

    expect(inventoryIds.some((id) => id === 'scenario.run' || id.startsWith('scenario.'))).toBe(false);
    expect(verificationIds.some((id) => id === 'scenario.run' || id.startsWith('scenario.'))).toBe(false);
  });

  it('keeps 031 quickstart and contracts aligned on promotion-gated scenario inventory', () => {
    const quickstart = readRepoFile('specs/031-query-scenario-package-and-command-taxonomy/quickstart.md');
    const taxonomy = readRepoFile('specs/031-query-scenario-package-and-command-taxonomy/contracts/command-taxonomy.md');
    const tree = readRepoFile('specs/031-query-scenario-package-and-command-taxonomy/contracts/command-tree-normalization.md');

    expect(quickstart).toContain('authoritative inventory / commandInventory mirror drift');
    expect(quickstart).toContain('`scenario` public promotion precondition check');
    expect(taxonomy).toContain('promotion preconditions');
    expect(tree).toContain('verification-case registry');
  });
});
