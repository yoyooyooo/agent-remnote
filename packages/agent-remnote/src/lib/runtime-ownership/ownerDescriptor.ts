import type { FixedOwnerClaim } from './claim.js';
import type { RuntimePortClassName } from './portClass.js';
import { runtimePortClassForContext } from './portClass.js';
import { resolveRuntimeOwnershipContext } from './profile.js';

export type RuntimeOwnerDescriptor = {
  readonly owner_channel: 'stable' | 'dev';
  readonly owner_id: string;
  readonly install_source: 'published_install' | 'source_tree';
  readonly runtime_root: string;
  readonly repo_root?: string | undefined;
  readonly worktree_root?: string | undefined;
  readonly port_class: RuntimePortClassName;
  readonly launcher_ref: string;
};

function envOverrideOwnerDescriptor(base: RuntimeOwnerDescriptor): RuntimeOwnerDescriptor {
  const ownerChannel = process.env.AGENT_REMNOTE_OWNER_CHANNEL;
  const installSource = process.env.AGENT_REMNOTE_OWNER_INSTALL_SOURCE;
  const runtimeRoot = process.env.AGENT_REMNOTE_OWNER_RUNTIME_ROOT;
  const repoRoot = process.env.AGENT_REMNOTE_OWNER_REPO_ROOT;
  const worktreeRoot = process.env.AGENT_REMNOTE_OWNER_WORKTREE_ROOT;
  const portClass = process.env.AGENT_REMNOTE_OWNER_PORT_CLASS;
  const launcherRef = process.env.AGENT_REMNOTE_LAUNCHER_REF;

  return {
    owner_channel: ownerChannel === 'stable' || ownerChannel === 'dev' ? ownerChannel : base.owner_channel,
    owner_id: ownerChannel === 'stable' || ownerChannel === 'dev' ? ownerChannel : base.owner_id,
    install_source:
      installSource === 'published_install' || installSource === 'source_tree' ? installSource : base.install_source,
    runtime_root: typeof runtimeRoot === 'string' && runtimeRoot.trim() ? runtimeRoot : base.runtime_root,
    repo_root: typeof repoRoot === 'string' && repoRoot.trim() ? repoRoot : base.repo_root,
    worktree_root: typeof worktreeRoot === 'string' && worktreeRoot.trim() ? worktreeRoot : base.worktree_root,
    port_class: portClass === 'canonical' || portClass === 'isolated' ? (portClass as RuntimePortClassName) : base.port_class,
    launcher_ref: typeof launcherRef === 'string' && launcherRef.trim() ? launcherRef : base.launcher_ref,
  };
}

export function currentRuntimeOwnerDescriptor(): RuntimeOwnerDescriptor {
  const ctx = resolveRuntimeOwnershipContext();
  const base = {
    owner_channel: ctx.runtimeProfile,
    owner_id: ctx.runtimeProfile,
    install_source: ctx.installSource,
    runtime_root: ctx.runtimeRoot,
    repo_root: ctx.repoRoot,
    worktree_root: ctx.worktreeRoot,
    port_class: runtimePortClassForContext(ctx),
    launcher_ref:
      ctx.runtimeProfile === 'stable'
        ? 'published:agent-remnote'
        : `source:${ctx.worktreeRoot ?? ctx.runtimeRoot}`,
  } satisfies RuntimeOwnerDescriptor;
  return envOverrideOwnerDescriptor(base);
}

export function ownerDescriptorForClaim(params: {
  readonly claim: FixedOwnerClaim;
  readonly currentRuntimeRoot: string;
  readonly repoRoot?: string | undefined;
  readonly worktreeRoot?: string | undefined;
}): RuntimeOwnerDescriptor {
  return {
    owner_channel: params.claim.claimed_channel,
    owner_id: params.claim.claimed_owner_id,
    install_source: params.claim.claimed_channel === 'stable' ? 'published_install' : 'source_tree',
    runtime_root: params.claim.claimed_channel === 'stable' ? params.claim.control_plane_root : params.currentRuntimeRoot,
    repo_root: params.claim.claimed_channel === 'dev' ? params.repoRoot : undefined,
    worktree_root: params.claim.claimed_channel === 'dev' ? params.worktreeRoot : undefined,
    port_class: params.claim.port_class,
    launcher_ref:
      params.claim.launcher_ref ??
      (params.claim.claimed_channel === 'stable'
        ? 'published:agent-remnote'
        : `source:${params.worktreeRoot ?? params.currentRuntimeRoot}`),
  };
}
