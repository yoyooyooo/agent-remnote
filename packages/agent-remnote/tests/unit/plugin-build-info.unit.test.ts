import { describe, expect, it } from 'vitest';

import { pluginBuildWarnings } from '../../src/lib/pluginBuildInfo.js';

describe('plugin build warnings', () => {
  it('reports mismatched expected/live plugin builds', () => {
    const warnings = pluginBuildWarnings({
      expected: {
        name: '@remnote/plugin',
        version: '0.0.2',
        build_id: 'expected-build',
        built_at: 1,
        source_stamp: 1,
        mode: 'dist',
      },
      live: {
        build_id: 'live-build',
      },
    });

    expect(warnings).toEqual(['plugin build mismatch: expected=expected-build live=live-build']);
  });
});
