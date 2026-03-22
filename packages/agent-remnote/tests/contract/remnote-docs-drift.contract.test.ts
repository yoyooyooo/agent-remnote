import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

function readRepoFile(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

describe('contract: remnote docs drift', () => {
  it('keeps user-facing docs and skill guidance aligned on the authoritative parity inventory', () => {
    const files = [
      'README.md',
      'README.zh-CN.md',
      'packages/agent-remnote/README.md',
      'skills/remnote/SKILL.md',
      'docs/ssot/agent-remnote/README.md',
      ...(existsSync(path.join(REPO_ROOT, 'README.local.md')) ? ['README.local.md'] : []),
      'specs/030-remnote-business-command-mode-parity/spec.md',
      'specs/030-remnote-business-command-mode-parity/contracts/parity-matrix.md',
    ];

    for (const relPath of files) {
      const text = readRepoFile(relPath);
      expect(text).toContain('runtime-mode-and-command-parity.md');
    }
  });

  it('keeps core SSoT docs aligned on the Wave 1 runtime spine', () => {
    const files = [
      'docs/ssot/agent-remnote/http-api-contract.md',
      'docs/ssot/agent-remnote/cli-contract.md',
      'docs/ssot/agent-remnote/tools-write.md',
      'docs/ssot/agent-remnote/ui-context-and-persistence.md',
      'docs/ssot/agent-remnote/write-input-surfaces.md',
      'specs/030-remnote-business-command-mode-parity/plan.md',
    ];

    for (const relPath of files) {
      const text = readRepoFile(relPath);
      expect(text).toContain('ModeParityRuntime');
    }
  });
});
