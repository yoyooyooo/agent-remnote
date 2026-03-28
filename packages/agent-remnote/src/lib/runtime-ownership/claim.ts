import fs from 'node:fs';
import path from 'node:path';
import * as Effect from 'effect/Effect';

import { CliError } from '../../services/Errors.js';
import type { RuntimeOwnershipContext } from './profile.js';
import type { RuntimeOwnerDescriptor } from './ownerDescriptor.js';

export type FixedOwnerClaim = {
  readonly claimed_channel: 'stable' | 'dev';
  readonly claimed_owner_id: string;
  readonly runtime_root: string;
  readonly control_plane_root: string;
  readonly port_class: 'canonical';
  readonly updated_by: 'initial_bootstrap' | 'doctor_fix' | 'stack_takeover';
  readonly updated_at: number;
  readonly repo_root?: string | undefined;
  readonly worktree_root?: string | undefined;
  readonly launcher_ref?: string | undefined;
};

export function fixedOwnerClaimFilePath(controlPlaneRoot: string): string {
  return path.join(controlPlaneRoot, 'fixed-owner-claim.json');
}

function fixedOwnerClaimLockPath(controlPlaneRoot: string): string {
  return path.join(controlPlaneRoot, 'fixed-owner-claim.lock');
}

function defaultStableClaim(ctx: RuntimeOwnershipContext): FixedOwnerClaim {
  return {
    claimed_channel: 'stable',
    claimed_owner_id: 'stable',
    runtime_root: ctx.controlPlaneRoot,
    control_plane_root: ctx.controlPlaneRoot,
    port_class: 'canonical',
    updated_by: 'initial_bootstrap',
    updated_at: 0,
  };
}

export function desiredFixedOwnerClaim(params: {
  readonly ctx: RuntimeOwnershipContext;
  readonly channel: 'stable' | 'dev';
  readonly updatedBy: FixedOwnerClaim['updated_by'];
}): FixedOwnerClaim {
  if (params.channel === 'stable') {
    return {
      ...defaultStableClaim(params.ctx),
      updated_by: params.updatedBy,
      updated_at: Date.now(),
      launcher_ref: 'published:agent-remnote',
    };
  }

  return {
    claimed_channel: 'dev',
    claimed_owner_id: 'dev',
    runtime_root: params.ctx.runtimeRoot,
    control_plane_root: params.ctx.controlPlaneRoot,
    port_class: 'canonical',
    updated_by: params.updatedBy,
    updated_at: Date.now(),
    repo_root: params.ctx.repoRoot,
    worktree_root: params.ctx.worktreeRoot,
    launcher_ref: `source:${params.ctx.worktreeRoot ?? params.ctx.runtimeRoot}`,
  };
}

export function readFixedOwnerClaim(ctx: RuntimeOwnershipContext): {
  readonly file: string;
  readonly claim: FixedOwnerClaim;
  readonly exists: boolean;
} {
  const file = fixedOwnerClaimFilePath(ctx.controlPlaneRoot);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<FixedOwnerClaim>;
    return {
      file,
      exists: true,
      claim: {
        ...defaultStableClaim(ctx),
        ...parsed,
        runtime_root: typeof parsed.runtime_root === 'string' && parsed.runtime_root.trim() ? parsed.runtime_root : ctx.controlPlaneRoot,
        control_plane_root: ctx.controlPlaneRoot,
        port_class: 'canonical',
      },
    };
  } catch {
    return { file, exists: false, claim: defaultStableClaim(ctx) };
  }
}

export function writeFixedOwnerClaim(params: {
  readonly file?: string | undefined;
  readonly ctx: RuntimeOwnershipContext;
  readonly claim: FixedOwnerClaim;
}): void {
  const file = params.file ?? fixedOwnerClaimFilePath(params.ctx.controlPlaneRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(params.claim, null, 2)}\n`, 'utf8');
}

export function withFixedOwnerClaimLock<A, E, R>(
  ctx: RuntimeOwnershipContext,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | CliError, R> {
  const lockPath = fixedOwnerClaimLockPath(ctx.controlPlaneRoot);
  return Effect.scoped(
    Effect.acquireRelease(
      Effect.try({
        try: () => {
          fs.mkdirSync(path.dirname(lockPath), { recursive: true });
          fs.mkdirSync(lockPath, { recursive: false });
        },
        catch: (error: any) => {
          if (error?.code === 'EEXIST') {
            return new CliError({
              code: 'INTERNAL',
              message: 'Another fixed-owner operation is already in progress',
              exitCode: 1,
              details: { lock_path: lockPath },
            });
          }
          return new CliError({
            code: 'INTERNAL',
            message: 'Failed to acquire fixed-owner claim lock',
            exitCode: 1,
            details: { lock_path: lockPath, error: String(error?.message || error) },
          });
        },
      }),
      () =>
        Effect.sync(() => {
          try {
            fs.rmSync(lockPath, { recursive: true, force: true });
          } catch {}
        }),
    ).pipe(Effect.zipRight(effect)),
  );
}

export function matchesFixedOwnerClaim(params: {
  readonly claim: FixedOwnerClaim;
  readonly owner: RuntimeOwnerDescriptor | null | undefined;
}): boolean {
  const owner = params.owner;
  if (!owner) return false;
  return (
    owner.owner_channel === params.claim.claimed_channel &&
    owner.runtime_root === params.claim.runtime_root &&
    owner.port_class === params.claim.port_class
  );
}

export function assertMayUseCanonicalPort(params: {
  readonly ctx: RuntimeOwnershipContext;
  readonly service: 'api' | 'plugin' | 'daemon';
  readonly requestedPort: number;
}): void {
  if (process.env.AGENT_REMNOTE_BYPASS_CLAIM_GUARD === '1') return;
  const canonicalPort = params.service === 'api' ? 3000 : params.service === 'plugin' ? 8080 : 6789;
  if (params.requestedPort !== canonicalPort) return;
  if (params.ctx.runtimeProfile !== 'dev') return;

  const { claim } = readFixedOwnerClaim(params.ctx);
  if (claim.claimed_channel === 'dev') return;

  throw new CliError({
    code: 'INVALID_ARGS',
    message: `Refusing to bind canonical ${params.service} port ${canonicalPort} while fixed owner claim is ${claim.claimed_channel}`,
    exitCode: 2,
    details: {
      service: params.service,
      requested_port: params.requestedPort,
      claimed_channel: claim.claimed_channel,
    },
  });
}

export function assertMayUseCanonicalWsUrl(params: {
  readonly ctx: RuntimeOwnershipContext;
  readonly wsUrl: string;
}): void {
  if (process.env.AGENT_REMNOTE_BYPASS_CLAIM_GUARD === '1') return;
  let parsed: URL;
  try {
    parsed = new URL(params.wsUrl);
  } catch {
    return;
  }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'wss:' ? 443 : 80;
  if (!Number.isFinite(port)) return;
  assertMayUseCanonicalPort({ ctx: params.ctx, service: 'daemon', requestedPort: port });
}

export function validateCanonicalPortUsage(params: {
  readonly ctx: RuntimeOwnershipContext;
  readonly service: 'api' | 'plugin' | 'daemon';
  readonly requestedPort: number;
}): Effect.Effect<void, CliError> {
  return Effect.try({
    try: () => assertMayUseCanonicalPort(params),
    catch: (error) =>
      error instanceof CliError
        ? error
        : new CliError({
            code: 'INTERNAL',
            message: `Failed to validate canonical ${params.service} port policy`,
            exitCode: 1,
            details: { error: String((error as any)?.message || error) },
          }),
  });
}

export function validateCanonicalWsUrlUsage(params: {
  readonly ctx: RuntimeOwnershipContext;
  readonly wsUrl: string;
}): Effect.Effect<void, CliError> {
  return Effect.try({
    try: () => assertMayUseCanonicalWsUrl(params),
    catch: (error) =>
      error instanceof CliError
        ? error
        : new CliError({
            code: 'INTERNAL',
            message: 'Failed to validate canonical daemon ws url policy',
            exitCode: 1,
            details: { error: String((error as any)?.message || error) },
          }),
  });
}
