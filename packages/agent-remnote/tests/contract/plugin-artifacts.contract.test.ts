import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { resolvePluginDistPath } from '../../src/lib/pluginArtifacts.js';
import { ENSURE_PLUGIN_ARTIFACTS_HOOK_TIMEOUT_MS, ensurePluginArtifacts } from '../helpers/ensurePluginArtifacts.js';

describe('cli contract: plugin artifacts', () => {
  beforeAll(async () => {
    await ensurePluginArtifacts();
  }, ENSURE_PLUGIN_ARTIFACTS_HOOK_TIMEOUT_MS);

  it('resolves a plugin dist directory with manifest.json', () => {
    const distPath = resolvePluginDistPath();

    expect(path.basename(distPath)).toBe('dist');
    expect(existsSync(path.join(distPath, 'manifest.json'))).toBe(true);
    expect(existsSync(path.join(distPath, 'index-sandbox.js'))).toBe(true);
  });
});
