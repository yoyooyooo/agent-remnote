import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { notionSkillExportConfigured, readNotionRemnoteGuidance } from '../helpers/notionSkillGuidance.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

function readRepoFile(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

describe('contract: 031 scenario docs propagation', () => {
  it('keeps 031 docs and README aligned on the pilot surfaces', () => {
    expect(readRepoFile('README.md')).toContain('scenario schema validate');
    expect(readRepoFile('README.zh-CN.md')).toContain('scenario schema validate');
    expect(readRepoFile('README.md')).toContain('scenario builtin install');
    expect(readRepoFile('README.zh-CN.md')).toContain('scenario builtin install');
    expect(readRepoFile('docs/ssot/agent-remnote/cli-contract.md')).toContain('feature-local planned namespace');
    expect(readRepoFile('docs/ssot/agent-remnote/http-api-contract.md')).toContain(
      '/v1/internal/query/resolve-powerup',
    );
    expect(readRepoFile('specs/031-query-scenario-package-and-command-taxonomy/quickstart.md')).toContain(
      '`scenario` public promotion precondition check',
    );
    expect(readRepoFile('README.md')).toContain('queryObj');
  });

  it.skipIf(!notionSkillExportConfigured)('checks pilot guidance in the complete Notion export', () => {
    const skill = readNotionRemnoteGuidance();
    expect(skill).toContain('~/.agent-remnote/scenarios');
    expect(skill).toContain('scenario builtin install');
  });
});
