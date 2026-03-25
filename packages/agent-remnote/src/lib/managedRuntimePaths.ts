import path from 'node:path';

import { resolveUserFilePath } from './paths.js';

export function resolveManagedStateFile(params: {
  readonly pidFilePath: string;
  readonly defaultStateFilePath: string;
  readonly explicitStateFilePath?: string | undefined;
  readonly candidate?: string | undefined;
}): string {
  const defaultPath = resolveUserFilePath(params.defaultStateFilePath);
  const explicitPath = params.explicitStateFilePath ? resolveUserFilePath(params.explicitStateFilePath) : undefined;
  const candidatePath = params.candidate ? resolveUserFilePath(params.candidate) : undefined;

  if (!candidatePath) {
    return explicitPath ?? defaultPath;
  }

  if (candidatePath === defaultPath) return candidatePath;
  if (explicitPath && candidatePath === explicitPath) return candidatePath;

  const pidRoot = path.dirname(params.pidFilePath);
  const rel = path.relative(pidRoot, candidatePath);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    return candidatePath;
  }

  return explicitPath ?? defaultPath;
}
