import { describe, expect, it } from 'vitest';
import * as Effect from 'effect/Effect';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { withFixedOwnerClaimLock } from '../../src/lib/runtime-ownership/claim.js';
import type { RuntimeOwnershipContext } from '../../src/lib/runtime-ownership/profile.js';

function stableContext(controlPlaneRoot: string): RuntimeOwnershipContext {
  return {
    controlPlaneRoot,
    runtimeRoot: controlPlaneRoot,
    runtimeProfile: 'stable',
    installSource: 'published_install',
  };
}

describe('runtime ownership claim lock', () => {
  it('reclaims a stale fixed-owner lock directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-fixed-owner-lock-'));
    const lockDir = path.join(tmpDir, 'fixed-owner-claim.lock');
    const staleAt = new Date(Date.now() - 10 * 60_000);

    try {
      await fs.mkdir(lockDir, { recursive: true });
      await fs.utimes(lockDir, staleAt, staleAt);

      const result = await Effect.runPromise(withFixedOwnerClaimLock(stableContext(tmpDir), Effect.succeed('ok')));
      expect(result).toBe('ok');
      await expect(fs.stat(lockDir)).rejects.toThrow();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
