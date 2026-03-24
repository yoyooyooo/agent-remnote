import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { remnoteCommandInventory } from '../../src/lib/business-semantics/commandInventory.js';
import { wave1RemnoteBusinessCommandVerificationCases } from '../helpers/remnoteBusinessCommandMatrix.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

function readRepoFile(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

describe('contract: scenario promotion preconditions', () => {
  it('keeps scenario surfaces outside current authoritative inventory before promotion', () => {
    const ids = remnoteCommandInventory.map((entry) => entry.id);
    expect(ids.some((id) => id === 'scenario.run' || id.startsWith('scenario.'))).toBe(false);
    expect(Object.keys(wave1RemnoteBusinessCommandVerificationCases).some((id) => id.startsWith('scenario.'))).toBe(false);
  });

  it('keeps docs and skill marked as planned / experimental for scenario run', () => {
    const files = [
      'README.md',
      'README.zh-CN.md',
      'skills/remnote/SKILL.md',
      'docs/ssot/agent-remnote/cli-contract.md',
      'specs/031-query-scenario-package-and-command-taxonomy/contracts/command-taxonomy.md',
    ];

    for (const relPath of files) {
      const text = readRepoFile(relPath);
      expect(text).toMatch(/planned|experimental|promotion preconditions/i);
    }
  });
});
