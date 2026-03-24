import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

function readRepoFile(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

describe('contract: 031 scenario docs propagation', () => {
  it('keeps 031 docs, README, and skill aligned on the pilot surfaces', () => {
    expect(readRepoFile('README.md')).toContain('scenario schema validate');
    expect(readRepoFile('README.zh-CN.md')).toContain('scenario schema validate');
    expect(readRepoFile('README.md')).toContain('scenario builtin install');
    expect(readRepoFile('README.zh-CN.md')).toContain('scenario builtin install');
    expect(readRepoFile('skills/remnote/SKILL.md')).toContain('~/.agent-remnote/scenarios');
    expect(readRepoFile('skills/remnote/SKILL.md')).toContain('scenario builtin install');
    expect(readRepoFile('docs/ssot/agent-remnote/cli-contract.md')).toContain('feature-local planned namespace');
    expect(readRepoFile('docs/ssot/agent-remnote/http-api-contract.md')).toContain('/v1/internal/query/resolve-powerup');
    expect(readRepoFile('specs/031-query-scenario-package-and-command-taxonomy/quickstart.md')).toContain(
      '`scenario` public promotion precondition check',
    );
    expect(readRepoFile('README.md')).toContain('queryObj');
  });
});
