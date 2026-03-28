import path from 'node:path';

import { resolveRuntimeOwnershipContext } from './profile.js';

export function defaultRuntimeRoot(): string {
  return resolveRuntimeOwnershipContext().runtimeRoot;
}

export function defaultControlPlanePath(...segments: readonly string[]): string {
  return path.join(resolveRuntimeOwnershipContext().controlPlaneRoot, ...segments);
}

export function defaultRuntimePath(...segments: readonly string[]): string {
  return path.join(defaultRuntimeRoot(), ...segments);
}
