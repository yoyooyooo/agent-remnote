import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  approvedWave1ModeInfrastructureFiles,
  wave1BusinessCommandFiles,
} from '../helpers/remnoteBusinessCommandContracts.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

describe('contract: remnote business command architecture', () => {
  it('tracks the Wave 1 command files that must migrate behind the runtime spine', () => {
    expect(wave1BusinessCommandFiles.length).toBeGreaterThan(0);
    expect(new Set(wave1BusinessCommandFiles).size).toBe(wave1BusinessCommandFiles.length);
  });

  it('tracks the approved infrastructure files that may own mode switching', () => {
    expect(approvedWave1ModeInfrastructureFiles).toEqual([
      'packages/agent-remnote/src/lib/business-semantics/commandContracts.ts',
      'packages/agent-remnote/src/lib/business-semantics/modeParityRuntime.ts',
      'packages/agent-remnote/src/lib/business-semantics/localModeAdapter.ts',
      'packages/agent-remnote/src/lib/business-semantics/remoteModeAdapter.ts',
      'packages/agent-remnote/src/lib/business-semantics/capabilityGuards.ts',
    ]);
  });

  it('blocks direct cfg.apiBaseUrl reads inside Wave 1 business command files', () => {
    for (const relPath of wave1BusinessCommandFiles) {
      const source = readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
      expect(source).not.toContain('cfg.apiBaseUrl');
    }
  });

  it('blocks direct HostApiClient imports inside Wave 1 business command files', () => {
    for (const relPath of wave1BusinessCommandFiles) {
      const source = readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
      expect(source).not.toMatch(/from ['"].*HostApiClient\.js['"]/);
      expect(source).not.toContain('HostApiClient');
    }
  });
});
