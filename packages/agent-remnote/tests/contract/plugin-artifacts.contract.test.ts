import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { resolvePluginDistPath } from '../../src/lib/pluginArtifacts.js';
import { ensurePluginArtifacts } from '../helpers/ensurePluginArtifacts.js';

describe('cli contract: plugin artifacts', () => {
  beforeAll(async () => {
    await ensurePluginArtifacts();
  });

  it('resolves a plugin dist directory with manifest.json', () => {
    const distPath = resolvePluginDistPath();

    expect(path.basename(distPath)).toBe('dist');
    expect(existsSync(path.join(distPath, 'manifest.json'))).toBe(true);
    expect(existsSync(path.join(distPath, 'index-sandbox.js'))).toBe(true);
  });
});
