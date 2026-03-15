import type { ReactRNPlugin } from '@remnote/plugin-sdk';

import { sleep } from '../shared/sleep';

export type SafeDeleteSubtreePolicy = {
  readonly maxDeleteSubtreeNodes?: number | undefined;
  readonly verifyTimeoutMs?: number | undefined;
  readonly verifyPollMs?: number | undefined;
};

export type SafeDeleteSubtreeResult = {
  readonly existed: boolean;
  readonly deleted: boolean;
  readonly mode: 'direct' | 'bottom_up';
  readonly nodeCount: number;
  readonly batchCount: number;
  readonly failedRemId?: string | undefined;
};

type TreeNode = {
  readonly id: string;
  readonly childIds: readonly string[];
};

type ResidualPlan = {
  readonly deleteRootIds: readonly string[];
  readonly residualRootId: string;
  readonly residualSize: number;
  readonly nodeCount: number;
};

const DEFAULT_MAX_DELETE_SUBTREE_NODES = 100;
const DEFAULT_VERIFY_TIMEOUT_MS = 3_000;
const DEFAULT_VERIFY_POLL_MS = 150;

function clampPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function getOrderedChildIds(rem: { readonly children?: readonly unknown[] } | null | undefined): string[] {
  if (!Array.isArray(rem?.children)) return [];
  return rem.children.filter((value: unknown) => typeof value === 'string' && value.trim()).map((value: string) => value.trim());
}

async function waitForRemToDisappear(
  plugin: ReactRNPlugin,
  remId: string,
  verifyTimeoutMs: number,
  verifyPollMs: number,
): Promise<boolean> {
  const deadline = Date.now() + verifyTimeoutMs;

  while (true) {
    const remaining = await plugin.rem.findOne(remId);
    if (!remaining) return true;

    if (Date.now() >= deadline) return false;
    await sleep(verifyPollMs);
  }
}

async function collectSubtreeTree(plugin: ReactRNPlugin, rootId: string): Promise<Map<string, TreeNode>> {
  const queue: string[] = [rootId];
  const seen = new Set<string>();
  const tree = new Map<string, TreeNode>();

  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const rem = await plugin.rem.findOne(id);
    if (!rem) continue;

    const childIds = getOrderedChildIds(rem);
    tree.set(id, { id, childIds });
    for (const childId of childIds) queue.push(childId);
  }

  return tree;
}

function chooseChildResidualsToKeep(sizes: readonly number[], capacity: number): Set<number> {
  if (capacity <= 0 || sizes.length === 0) return new Set<number>();

  const possible = new Array<boolean>(capacity + 1).fill(false);
  const parentSum = new Array<number>(capacity + 1).fill(-1);
  const parentIndex = new Array<number>(capacity + 1).fill(-1);
  possible[0] = true;

  for (let index = 0; index < sizes.length; index += 1) {
    const size = sizes[index]!;
    for (let sum = capacity; sum >= size; sum -= 1) {
      if (!possible[sum] && possible[sum - size]) {
        possible[sum] = true;
        parentSum[sum] = sum - size;
        parentIndex[sum] = index;
      }
    }
  }

  let best = capacity;
  while (best > 0 && !possible[best]) best -= 1;

  const keep = new Set<number>();
  let cursor = best;
  while (cursor > 0) {
    const index = parentIndex[cursor];
    if (index < 0) break;
    keep.add(index);
    cursor = parentSum[cursor]!;
  }
  return keep;
}

function planDeleteRoots(tree: Map<string, TreeNode>, rootId: string, maxDeleteSubtreeNodes: number): ResidualPlan {
  const visit = (nodeId: string): ResidualPlan => {
    const node = tree.get(nodeId);
    if (!node) {
      return {
        deleteRootIds: [],
        residualRootId: nodeId,
        residualSize: 1,
        nodeCount: 1,
      };
    }

    const childPlans = node.childIds.map((childId) => visit(childId));
    const deleteRootIds: string[] = [];
    let nodeCount = 1;

    for (const childPlan of childPlans) {
      deleteRootIds.push(...childPlan.deleteRootIds);
      nodeCount += childPlan.nodeCount;
    }

    const keep = chooseChildResidualsToKeep(
      childPlans.map((childPlan) => childPlan.residualSize),
      Math.max(0, maxDeleteSubtreeNodes - 1),
    );

    let residualSize = 1;
    for (let index = 0; index < childPlans.length; index += 1) {
      const childPlan = childPlans[index]!;
      if (keep.has(index)) residualSize += childPlan.residualSize;
      else deleteRootIds.push(childPlan.residualRootId);
    }

    return {
      deleteRootIds,
      residualRootId: nodeId,
      residualSize,
      nodeCount,
    };
  };

  return visit(rootId);
}

async function deleteRemWithVerification(
  plugin: ReactRNPlugin,
  remId: string,
  verifyTimeoutMs: number,
  verifyPollMs: number,
): Promise<boolean> {
  const rem = await plugin.rem.findOne(remId);
  if (!rem) return true;

  await rem.remove();
  return waitForRemToDisappear(plugin, remId, verifyTimeoutMs, verifyPollMs);
}

export async function safeDeleteSubtree(
  plugin: ReactRNPlugin,
  rootId: string,
  policy: SafeDeleteSubtreePolicy = {},
): Promise<SafeDeleteSubtreeResult> {
  const maxDeleteSubtreeNodes = clampPositiveInt(policy.maxDeleteSubtreeNodes, DEFAULT_MAX_DELETE_SUBTREE_NODES);
  const verifyTimeoutMs = clampPositiveInt(policy.verifyTimeoutMs, DEFAULT_VERIFY_TIMEOUT_MS);
  const verifyPollMs = clampPositiveInt(policy.verifyPollMs, DEFAULT_VERIFY_POLL_MS);

  const root = await plugin.rem.findOne(rootId);
  if (!root) {
    return {
      existed: false,
      deleted: true,
      mode: 'direct',
      nodeCount: 0,
      batchCount: 0,
    };
  }

  const tree = await collectSubtreeTree(plugin, rootId);
  const plan = planDeleteRoots(tree, rootId, maxDeleteSubtreeNodes);
  const deleteRootIds = [...plan.deleteRootIds, plan.residualRootId];
  const mode: 'direct' | 'bottom_up' = deleteRootIds.length === 1 ? 'direct' : 'bottom_up';

  for (const deleteRootId of deleteRootIds) {
    const deleted = await deleteRemWithVerification(plugin, deleteRootId, verifyTimeoutMs, verifyPollMs);
    if (!deleted) {
      return {
        existed: true,
        deleted: false,
        mode,
        nodeCount: plan.nodeCount,
        batchCount: deleteRootIds.length,
        failedRemId: deleteRootId,
      };
    }
  }

  return {
    existed: true,
    deleted: true,
    mode,
    nodeCount: plan.nodeCount,
    batchCount: deleteRootIds.length,
  };
}
