import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

describe('contract: remnote business semantics architecture', () => {
  it('keeps write placement resolution out of command-owned remote branching', () => {
    const source = readFileSync(
      path.join(REPO_ROOT, 'packages/agent-remnote/src/commands/write/_placementSpec.ts'),
      'utf8',
    );

    expect(source).not.toContain('cfg.apiBaseUrl');
    expect(source).not.toMatch(/from ['"].*HostApiClient\.js['"]/);
    expect(source).not.toContain('yield* HostApiClient');
  });

  it('keeps write ref resolution out of command-owned remote branching', () => {
    const source = readFileSync(
      path.join(REPO_ROOT, 'packages/agent-remnote/src/commands/write/_refValue.ts'),
      'utf8',
    );

    expect(source).not.toContain('cfg.apiBaseUrl');
    expect(source).not.toMatch(/from ['"].*HostApiClient\.js['"]/);
    expect(source).not.toContain('yield* HostApiClient');
  });

  it('keeps promotion title inference out of command-owned remote branching', () => {
    const source = readFileSync(
      path.join(REPO_ROOT, 'packages/agent-remnote/src/commands/write/rem/_promotion.ts'),
      'utf8',
    );

    expect(source).not.toContain('cfg.apiBaseUrl');
    expect(source).not.toMatch(/from ['"].*HostApiClient\.js['"]/);
    expect(source).not.toContain('yield* HostApiClient');
  });

  it('keeps selection snapshot normalization out of command-owned shared helpers', () => {
    const source = readFileSync(
      path.join(REPO_ROOT, 'packages/agent-remnote/src/commands/read/selection/_shared.ts'),
      'utf8',
    );

    expect(source).not.toContain('resolveStateFilePath');
    expect(source).not.toContain('pickClient');
    expect(source).not.toContain('readJson');
  });

  it('keeps ui-context snapshot normalization out of command-owned shared helpers', () => {
    const source = readFileSync(
      path.join(REPO_ROOT, 'packages/agent-remnote/src/commands/read/uiContext/_shared.ts'),
      'utf8',
    );

    expect(source).not.toContain('resolveStateFilePath');
    expect(source).not.toContain('pickClient');
    expect(source).not.toContain('readJson');
  });
});
