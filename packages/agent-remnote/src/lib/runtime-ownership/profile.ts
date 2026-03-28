import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { homeDir, resolveUserFilePath } from '../paths.js';

export type RuntimeProfileName = 'stable' | 'dev';
export type InstallSourceName = 'published_install' | 'source_tree';

export type RuntimeOwnershipContext = {
  readonly controlPlaneRoot: string;
  readonly runtimeRoot: string;
  readonly runtimeProfile: RuntimeProfileName;
  readonly installSource: InstallSourceName;
  readonly repoRoot?: string | undefined;
  readonly worktreeRoot?: string | undefined;
};

function worktreeKeyFor(root: string): string {
  return createHash('sha256').update(path.normalize(root)).digest('hex').slice(0, 12);
}

function currentEntryScript(): string | undefined {
  const script = process.argv[1];
  if (typeof script !== 'string' || !script.trim()) return undefined;
  return resolveUserFilePath(script);
}

function hasGitMarker(targetDir: string): boolean {
  try {
    fs.accessSync(path.join(targetDir, '.git'));
    return true;
  } catch {
    return false;
  }
}

function findGitRoot(startPath: string): string | undefined {
  let cur = path.dirname(startPath);
  for (;;) {
    if (hasGitMarker(cur)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
}

function isSourceTreeEntrypoint(entryScript: string, gitRoot: string): boolean {
  const rel = path.relative(gitRoot, entryScript).split(path.sep).join('/');
  return (
    rel === 'packages/agent-remnote/src/main.ts' ||
    rel === 'packages/agent-remnote/cli.js' ||
    rel === 'packages/agent-remnote/dist/main.js'
  );
}

export function defaultControlPlaneRoot(): string {
  const envRoot = process.env.REMNOTE_CONTROL_PLANE_ROOT || process.env.AGENT_REMNOTE_CONTROL_PLANE_ROOT;
  if (typeof envRoot === 'string' && envRoot.trim()) return resolveUserFilePath(envRoot);
  return path.join(homeDir(), '.agent-remnote');
}

export function resolveRuntimeOwnershipContext(): RuntimeOwnershipContext {
  const controlPlaneRoot = defaultControlPlaneRoot();
  const entryScript = currentEntryScript();
  const gitRoot = entryScript ? findGitRoot(entryScript) : undefined;
  const sourceTree = !!(entryScript && gitRoot && isSourceTreeEntrypoint(entryScript, gitRoot));
  const installSource: InstallSourceName = sourceTree ? 'source_tree' : 'published_install';
  const runtimeProfile: RuntimeProfileName = sourceTree ? 'dev' : 'stable';
  const worktreeRoot = sourceTree ? gitRoot : undefined;
  const runtimeRoot =
    runtimeProfile === 'stable' ? controlPlaneRoot : path.join(controlPlaneRoot, 'dev', worktreeKeyFor(worktreeRoot!));

  return {
    controlPlaneRoot,
    runtimeRoot,
    runtimeProfile,
    installSource,
    repoRoot: worktreeRoot,
    worktreeRoot,
  };
}
