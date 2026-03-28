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

const FIXED_OWNER_CLAIM_LOCK_STALE_MS = 60_000;
const FIXED_OWNER_CLAIM_LOCK_META_FILE = 'meta.json';

type FixedOwnerClaimLockMeta = {
  readonly pid?: number | undefined;
  readonly acquired_at?: number | undefined;
};

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
  const metaPath = path.join(lockPath, FIXED_OWNER_CLAIM_LOCK_META_FILE);

  const writeMeta = () => {
    const meta: FixedOwnerClaimLockMeta = {
      pid: process.pid,
      acquired_at: Date.now(),
    };
    fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  };

  const readMeta = (): FixedOwnerClaimLockMeta | undefined => {
    try {
      const raw = fs.readFileSync(metaPath, 'utf8');
      const parsed = JSON.parse(raw) as FixedOwnerClaimLockMeta;
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch {
      return undefined;
    }
  };

  const isPidAlive = (pid: number): boolean => {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: any) {
      return error?.code === 'EPERM';
    }
  };

  const readLockState = () => {
    const meta = readMeta();
    const now = Date.now();
    const acquiredAt = typeof meta?.acquired_at === 'number' && Number.isFinite(meta.acquired_at) ? meta.acquired_at : undefined;
    const metaExpired = acquiredAt !== undefined && now - acquiredAt > FIXED_OWNER_CLAIM_LOCK_STALE_MS;
    const ownerPid = typeof meta?.pid === 'number' ? meta.pid : undefined;
    const ownerAlive = ownerPid !== undefined && isPidAlive(ownerPid);
    const ownerDead = ownerPid !== undefined && !ownerAlive;
    if (ownerAlive) {
      return {
        reclaimable: false,
        reason: 'live_lock',
        meta,
      } as const;
    }
    try {
      const stat = fs.statSync(lockPath);
      const mtimeExpired = now - stat.mtimeMs > FIXED_OWNER_CLAIM_LOCK_STALE_MS;
      return {
        reclaimable: ownerDead || ((ownerPid === undefined || acquiredAt === undefined) && mtimeExpired) || (ownerPid === undefined && metaExpired),
        reason: ownerDead ? 'pid_not_running' : metaExpired ? 'metadata_expired' : mtimeExpired ? 'mtime_expired' : 'live_lock',
        meta,
      } as const;
    } catch {
      return {
        reclaimable: ownerDead || (ownerPid === undefined && metaExpired),
        reason: ownerDead ? 'pid_not_running' : metaExpired ? 'metadata_expired' : 'live_lock',
        meta,
      } as const;
    }
  };

  const failLockBusy = () => {
    const state = readLockState();
    return new CliError({
      code: 'INTERNAL',
      message: 'Another fixed-owner operation is already in progress',
      exitCode: 1,
      details: {
        lock_path: lockPath,
        reason: state.reason,
        owner_pid: state.meta?.pid,
        acquired_at: state.meta?.acquired_at,
      },
    });
  };

  const acquire = () => {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        fs.mkdirSync(lockPath, { recursive: false });
        writeMeta();
        return;
      } catch (error: any) {
        if (error?.code !== 'EEXIST') {
          throw new CliError({
            code: 'INTERNAL',
            message: 'Failed to acquire fixed-owner claim lock',
            exitCode: 1,
            details: { lock_path: lockPath, error: String(error?.message || error) },
          });
        }

        const state = readLockState();
        if (!state.reclaimable) throw failLockBusy();

        try {
          fs.rmSync(lockPath, { recursive: true, force: true });
        } catch (rmError: any) {
          throw new CliError({
            code: 'INTERNAL',
            message: 'Failed to reclaim stale fixed-owner claim lock',
            exitCode: 1,
            details: {
              lock_path: lockPath,
              reason: state.reason,
              error: String(rmError?.message || rmError),
            },
          });
        }
      }
    }

    try {
      fs.mkdirSync(lockPath, { recursive: false });
      writeMeta();
    } catch (error: any) {
      if (error?.code === 'EEXIST') throw failLockBusy();
      throw new CliError({
        code: 'INTERNAL',
        message: 'Failed to acquire fixed-owner claim lock',
        exitCode: 1,
        details: { lock_path: lockPath, error: String(error?.message || error) },
      });
    }
  };

  return Effect.scoped(
    Effect.acquireRelease(
      Effect.try({
        try: acquire,
        catch: (error) =>
          error instanceof CliError
            ? error
            : new CliError({
                code: 'INTERNAL',
                message: 'Failed to acquire fixed-owner claim lock',
                exitCode: 1,
                details: { lock_path: lockPath, error: String((error as any)?.message || error) },
              }),
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
  readonly bypassGuard?: boolean | undefined;
}): void {
  if (params.bypassGuard || process.env.AGENT_REMNOTE_BYPASS_CLAIM_GUARD === '1') return;
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
  readonly bypassGuard?: boolean | undefined;
}): void {
  if (params.bypassGuard || process.env.AGENT_REMNOTE_BYPASS_CLAIM_GUARD === '1') return;
  let parsed: URL;
  try {
    parsed = new URL(params.wsUrl);
  } catch {
    return;
  }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'wss:' ? 443 : 80;
  if (!Number.isFinite(port)) return;
  assertMayUseCanonicalPort({ ctx: params.ctx, service: 'daemon', requestedPort: port, bypassGuard: params.bypassGuard });
}

export function validateCanonicalPortUsage(params: {
  readonly ctx: RuntimeOwnershipContext;
  readonly service: 'api' | 'plugin' | 'daemon';
  readonly requestedPort: number;
  readonly bypassGuard?: boolean | undefined;
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
  readonly bypassGuard?: boolean | undefined;
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
