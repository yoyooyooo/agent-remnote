import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { RuntimeBuildInfo } from './runtimeBuildInfo.js';
import { resolvePluginDistPath } from './pluginArtifacts.js';

export function readPluginDistBuildInfo(distPath: string): RuntimeBuildInfo | null {
  const normalized = typeof distPath === 'string' ? distPath.trim() : '';
  if (!normalized) return null;
  const target = path.join(normalized, 'build-info.json');
  try {
    const raw = readFileSync(target, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.name === 'string' &&
      typeof parsed?.version === 'string' &&
      typeof parsed?.build_id === 'string' &&
      typeof parsed?.built_at === 'number' &&
      typeof parsed?.source_stamp === 'number'
    ) {
      return {
        name: parsed.name,
        version: parsed.version,
        build_id: parsed.build_id,
        built_at: parsed.built_at,
        source_stamp: parsed.source_stamp,
        mode: parsed.mode === 'src' || parsed.mode === 'dist' || parsed.mode === 'unknown' ? parsed.mode : 'dist',
      };
    }
  } catch {}
  return null;
}

export function currentExpectedPluginBuildInfo(): RuntimeBuildInfo | null {
  try {
    const dist = resolvePluginDistPath();
    return readPluginDistBuildInfo(dist);
  } catch {
    return null;
  }
}

export function pluginBuildWarnings(params: {
  readonly expected: RuntimeBuildInfo | null | undefined;
  readonly live: { readonly build_id: string } | null | undefined;
}): readonly string[] {
  if (!params.expected || !params.live) return [];
  if (params.expected.build_id === params.live.build_id) return [];
  return [
    `plugin build mismatch: expected=${params.expected.build_id} live=${params.live.build_id}`,
  ];
}
