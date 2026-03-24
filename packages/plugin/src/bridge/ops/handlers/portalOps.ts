import type { ReactRNPlugin } from '@remnote/plugin-sdk';

import type { OpDispatch } from '../types';

function normalizeId(x: unknown): string {
  return typeof x === 'string' ? x.trim() : '';
}

function normalizePosition(x: unknown): number | undefined {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) return undefined;
  return Math.floor(x);
}

const APPEND_POSITION = 1_000_000_000;

async function createSinglePortal(params: {
  readonly plugin: ReactRNPlugin;
  readonly parentId: string;
  readonly targetRemId: string;
  readonly position?: unknown;
  readonly clientTempId?: unknown;
}): Promise<any> {
  const parentId = normalizeId(params.parentId);
  if (!parentId) throw new Error('Missing parent_id (refusing to create a Portal without a parent)');
  const targetRemId = normalizeId(params.targetRemId);
  if (!targetRemId) throw new Error('Missing target_rem_id (or rem_id) for portal target');

  const portal = await params.plugin.rem.createPortal();
  if (!portal?._id) throw new Error('createPortal returned null');

  const rollbackPortal = async () => {
    try {
      await portal.remove();
    } catch {}
  };

  try {
    const pos = normalizePosition(params.position) ?? APPEND_POSITION;
    await params.plugin.rem.moveRems([portal._id], parentId, pos);
  } catch (e) {
    await rollbackPortal();
    throw e;
  }

  const target = await params.plugin.rem.findOne(targetRemId);
  if (!target) {
    await rollbackPortal();
    throw new Error(`Target Rem not found: ${targetRemId}`);
  }

  try {
    // Older SDK builds may not expose addToPortal.
    if (typeof (target as any).addToPortal !== 'function') {
      throw new Error('addToPortal not available in SDK');
    }
    await (target as any).addToPortal(portal._id);
  } catch (e) {
    await rollbackPortal();
    throw e;
  }

  const result: any = { ok: true, portal_id: portal._id, target_rem_id: targetRemId, parent_id: parentId };
  if (params.clientTempId && portal._id) {
    result.created = { client_temp_id: params.clientTempId, remote_id: portal._id, remote_type: 'rem' };
  }
  return result;
}

export async function executeCreatePortal(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { parent_id, target_rem_id, rem_id, position, client_temp_id } = op.payload || {};
  return await createSinglePortal({
    plugin,
    parentId: parent_id,
    targetRemId: target_rem_id ?? rem_id,
    position,
    clientTempId: client_temp_id,
  });
}

export async function executeCreatePortalBulk(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { parent_id, items } = op.payload || {};
  const parentId = normalizeId(parent_id);
  if (!parentId) throw new Error('Missing parent_id (refusing to create a Portal without a parent)');

  const normalizedItems = Array.isArray(items)
    ? items
        .filter((value) => value && typeof value === 'object')
        .map((item) => item as Record<string, unknown>)
    : [];
  if (normalizedItems.length === 0) throw new Error('Missing items');

  const itemResults: Array<{ target_rem_id: string; portal_id: string }> = new Array(normalizedItems.length);
  const allImplicitPositions = normalizedItems.every((item) => normalizePosition(item.position) === undefined);
  const executionOrder = normalizedItems.map((item, index) => ({ item, index }));

  for (const entry of executionOrder) {
    const { item, index } = entry;
    const targetRemId = normalizeId(item.target_rem_id ?? item.rem_id);
    const single = await createSinglePortal({
      plugin,
      parentId,
      targetRemId,
      position: allImplicitPositions ? APPEND_POSITION : item.position ?? index,
      clientTempId: item.client_temp_id,
    });
    itemResults[index] = {
      target_rem_id: targetRemId,
      portal_id: String(single.portal_id),
    };
  }

  return {
    ok: true,
    parent_id: parentId,
    created_count: itemResults.length,
    item_results: itemResults,
  };
}
