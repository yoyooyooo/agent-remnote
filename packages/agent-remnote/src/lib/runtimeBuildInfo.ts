import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export type RuntimeBuildInfo = {
  readonly name: string;
  readonly version: string;
  readonly build_id: string;
  readonly built_at: number;
  readonly source_stamp: number;
  readonly mode: 'src' | 'dist' | 'unknown';
};

type BuildComparable = {
  readonly build_id: string;
} | null | undefined;

function packageInfo(): { readonly name: string; readonly version: string } {
  try {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw);
    const name = typeof parsed?.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'agent-remnote';
    const version = typeof parsed?.version === 'string' && parsed.version.trim() ? parsed.version.trim() : '0.0.0';
    return { name, version };
  } catch {
    return { name: 'agent-remnote', version: '0.0.0' };
  }
}

function fileMtimeMs(targetPath: string): number {
  try {
    return Math.floor(statSync(targetPath).mtimeMs);
  } catch {
    return 0;
  }
}

function latestMtimeMs(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  let max = 0;
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile()) {
        max = Math.max(max, Math.floor(st.mtimeMs));
      }
    }
  }
  return max;
}

function detectMode(): RuntimeBuildInfo['mode'] {
  const url = import.meta.url;
  if (url.includes('/src/')) return 'src';
  if (url.includes('/dist/')) return 'dist';
  return 'unknown';
}

function computeDefaultBuildInfo(): RuntimeBuildInfo {
  const pkg = packageInfo();
  const mode = detectMode();
  const srcDir = new URL('../', import.meta.url);
  const packageJson = new URL('../../package.json', import.meta.url);
  const sourceStamp = Math.max(
    latestMtimeMs(srcDir.pathname),
    fileMtimeMs(packageJson.pathname),
  );
  const buildIdInput = `${pkg.name}\n${pkg.version}\n${mode}\n${sourceStamp}`;
  const buildId = createHash('sha256').update(buildIdInput).digest('hex').slice(0, 12);
  return {
    name: pkg.name,
    version: pkg.version,
    build_id: `${pkg.version}:${buildId}`,
    built_at: sourceStamp || Date.now(),
    source_stamp: sourceStamp || Date.now(),
    mode,
  };
}

let cached: RuntimeBuildInfo | undefined;

export function currentRuntimeBuildInfo(): RuntimeBuildInfo {
  if (cached) return cached;
  const defaultInfo = computeDefaultBuildInfo();
  cached = {
    name: process.env.AGENT_REMNOTE_NAME?.trim() || defaultInfo.name,
    version: process.env.AGENT_REMNOTE_VERSION?.trim() || defaultInfo.version,
    build_id: process.env.AGENT_REMNOTE_BUILD_ID?.trim() || defaultInfo.build_id,
    built_at: Number(process.env.AGENT_REMNOTE_BUILD_AT ?? defaultInfo.built_at),
    source_stamp: Number(process.env.AGENT_REMNOTE_SOURCE_STAMP ?? defaultInfo.source_stamp),
    mode:
      process.env.AGENT_REMNOTE_BUILD_MODE === 'src' ||
      process.env.AGENT_REMNOTE_BUILD_MODE === 'dist' ||
      process.env.AGENT_REMNOTE_BUILD_MODE === 'unknown'
        ? (process.env.AGENT_REMNOTE_BUILD_MODE as RuntimeBuildInfo['mode'])
        : defaultInfo.mode,
  };
  return cached;
}

export function runtimeVersionWarnings(params: {
  readonly current: RuntimeBuildInfo;
  readonly daemon?: BuildComparable;
  readonly plugin?: BuildComparable;
  readonly api?: BuildComparable;
}): readonly string[] {
  const warnings: string[] = [];
  const compare = (label: string, other: BuildComparable) => {
    if (!other) return;
    if (other.build_id !== params.current.build_id) {
      warnings.push(
        `${label} build mismatch: current=${params.current.build_id} live=${other.build_id}`,
      );
    }
  };
  compare('daemon', params.daemon);
  compare('plugin', params.plugin);
  compare('api', params.api);
  return warnings;
}
