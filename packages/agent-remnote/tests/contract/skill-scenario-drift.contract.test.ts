import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const SKILL_PATH = path.join(REPO_ROOT, 'skills/remnote/SKILL.md');

describe('contract: remnote skill scenario drift', () => {
  it('keeps skill guidance aligned with scenario authoring and user-store routing', () => {
    const skill = readFileSync(SKILL_PATH, 'utf8');

    for (const subcommand of ['validate', 'normalize', 'explain', 'generate']) {
      expect(skill).toContain(`scenario schema ${subcommand}`);
    }

    expect(skill).toContain('scenario builtin install');
    expect(skill).toContain('~/.agent-remnote/scenarios');
    expect(skill).toContain('scenario run');
    expect(skill).toMatch(/planned|experimental/i);
    expect(skill).not.toContain('031 Scenario 注意事项');
  });
});
