import type { ReactRNPlugin } from '@remnote/plugin-sdk';

import type { OpDispatch } from '../types';

function normalizeId(x: unknown): string {
  return typeof x === 'string' ? x.trim() : '';
}

function normalizePosition(x: unknown): number | undefined {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) return undefined;
  return Math.floor(x);
}

export async function executeCreatePortal(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { parent_id, target_rem_id, rem_id, position, client_temp_id } = op.payload || {};
  const parentId = normalizeId(parent_id);
  if (!parentId) throw new Error('Missing parent_id (refusing to create a Portal without a parent)');

  const targetRemId = normalizeId(target_rem_id ?? rem_id);
  if (!targetRemId) throw new Error('Missing target_rem_id (or rem_id) for portal target');

  const portal = await plugin.rem.createPortal();
  if (!portal?._id) throw new Error('createPortal returned null');

  const rollbackPortal = async () => {
    try {
      await portal.remove();
    } catch {}
  };

  try {
    const pos = normalizePosition(position) ?? 0;
    await plugin.rem.moveRems([portal._id], parentId, pos);
  } catch (e) {
    await rollbackPortal();
    throw e;
  }

  const target = await plugin.rem.findOne(targetRemId);
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
  if (client_temp_id && portal._id) {
    result.created = { client_temp_id, remote_id: portal._id, remote_type: 'rem' };
  }
  return result;
}
