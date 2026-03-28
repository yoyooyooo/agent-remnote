import { createHash } from 'node:crypto';
import path from 'node:path';

import type { RuntimeOwnershipContext } from './profile.js';

export type RuntimePortClassName = 'canonical' | 'isolated';

function isolatedSeed(root: string): number {
  return parseInt(createHash('sha256').update(path.normalize(root)).digest('hex').slice(0, 8), 16);
}

export function runtimePortClassForContext(ctx: RuntimeOwnershipContext): RuntimePortClassName {
  return ctx.runtimeProfile === 'stable' ? 'canonical' : 'isolated';
}

export function defaultWsPortForContext(ctx: RuntimeOwnershipContext): number {
  if (runtimePortClassForContext(ctx) === 'canonical') return 6789;
  return 46_000 + (isolatedSeed(ctx.runtimeRoot) % 2_000);
}

export function defaultApiPortForContext(ctx: RuntimeOwnershipContext): number {
  if (runtimePortClassForContext(ctx) === 'canonical') return 3000;
  return 48_000 + (isolatedSeed(ctx.runtimeRoot) % 2_000);
}

export function defaultPluginPortForContext(ctx: RuntimeOwnershipContext): number {
  if (runtimePortClassForContext(ctx) === 'canonical') return 8080;
  return 50_000 + (isolatedSeed(ctx.runtimeRoot) % 2_000);
}
