import type { ReactRNPlugin } from '@remnote/plugin-sdk';

import { safeDeleteSubtree } from '../../remnote/safeDeleteSubtree';
import { toRichText } from '../../remnote/richText';

import type { OpDispatch } from '../types';

function readMaxDeleteSubtreeNodes(payload: any): number | undefined {
  const raw = payload?.max_delete_subtree_nodes;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

async function executeDeleteWithSafeSubtree(
  plugin: ReactRNPlugin,
  op: OpDispatch,
  params: {
    readonly errorContext: 'rem deletion' | 'backup deletion';
    readonly includeRemIdInSuccess: boolean;
  },
): Promise<any> {
  const { rem_id } = op.payload || {};
  const remId = typeof rem_id === 'string' ? rem_id.trim() : '';
  if (!remId) return { ok: false, fatal: true, error: 'Missing rem_id' };
  const maxDeleteSubtreeNodes = readMaxDeleteSubtreeNodes(op.payload);

  const result = await safeDeleteSubtree(plugin, remId, {
    maxDeleteSubtreeNodes: maxDeleteSubtreeNodes ?? 100,
  });

  if (!result.deleted) {
    return {
      ok: false,
      fatal: true,
      error: `Failed to verify ${params.errorContext}; Rem still exists: ${result.failedRemId ?? remId}`,
      rem_id: remId,
    };
  }

  return {
    ok: true,
    ...(params.includeRemIdInSuccess ? { rem_id: remId } : {}),
    deleted: true,
    existed: result.existed,
    delete_mode: result.mode,
    node_count: result.nodeCount,
    batch_count: result.batchCount,
  };
}

export async function executeCreateRem(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { parent_id, text, tags, is_document, standalone, client_temp_id, position } = op.payload || {};
  const parentId = typeof parent_id === 'string' ? parent_id.trim() : '';
  const isStandalone = standalone === true;
  if (!parentId && !isStandalone) throw new Error('Missing parent_id (refusing to create a Rem without a parent)');
  const rem = await plugin.rem.createRem();
  if (!rem) throw new Error('createRem returned null');

  const rollback = async () => {
    try {
      await rem.remove();
    } catch {}
  };

  try {
    const pos = typeof position === 'number' && Number.isFinite(position) && position >= 0 ? Math.floor(position) : 0;
    if (parentId) {
      await plugin.rem.moveRems([rem._id], parentId, pos);
    }

    if (is_document === true) {
      // @ts-ignore - SDK Rem.setIsDocument may exist in some versions.
      if (typeof (rem as any).setIsDocument === 'function') {
        await (rem as any).setIsDocument(true);
      }
    }
    if (text !== undefined) {
      // @ts-ignore
      await rem.setText(toRichText(text));
    }
    if (Array.isArray(tags) && tags.length > 0) {
      for (const t of tags) {
        // @ts-ignore
        await rem.addTag(t);
      }
    }
  } catch (e) {
    await rollback();
    throw e;
  }
  const result: any = { ok: true };
  if (client_temp_id && rem._id) {
    result.created = { client_temp_id, remote_id: rem._id, remote_type: 'rem' };
  }
  return result;
}

export async function executeCreateLinkRem(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { url, add_title, client_temp_id, parent_id } = op.payload || {};
  const parentId = typeof parent_id === 'string' ? parent_id.trim() : '';
  if (!parentId) throw new Error('Missing parent_id (refusing to create a Rem without a parent)');
  const rem = await plugin.rem.createLinkRem(String(url ?? ''), add_title !== false);
  if (!rem) throw new Error('createLinkRem returned null');
  try {
    await plugin.rem.moveRems([rem._id], parentId, 0);
  } catch (e) {
    try {
      await rem.remove();
    } catch {}
    throw e;
  }
  const result: any = { ok: true };
  if (client_temp_id && rem._id) result.created = { client_temp_id, remote_id: rem._id, remote_type: 'rem' };
  return result;
}

export async function executeUpdateText(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { rem_id, text } = op.payload || {};
  if (!rem_id) throw new Error('Missing rem_id');
  const rem = await plugin.rem.findOne(rem_id);
  if (!rem) throw new Error(`Rem not found: ${rem_id}`);
  // @ts-ignore
  await rem.setText(toRichText(text));
  return { ok: true };
}

export async function executeMoveRem(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { rem_id, new_parent_id, position, standalone, is_document, leave_portal } = op.payload || {};
  const remId = typeof rem_id === 'string' ? rem_id.trim() : '';
  const newParentId = typeof new_parent_id === 'string' ? new_parent_id.trim() : '';
  const moveToStandalone = standalone === true;
  if (!remId) throw new Error('Missing rem_id');
  if (!moveToStandalone && !newParentId) throw new Error('Missing new_parent_id');

  const rem = await plugin.rem.findOne(remId);
  if (!rem) throw new Error(`Rem not found: ${remId}`);

  const sourceParentId = typeof (rem as any).parent === 'string' ? String((rem as any).parent).trim() : '';
  let sourcePosition = 0;
  try {
    if (typeof (rem as any).positionAmongstSiblings === 'function') {
      const value = await (rem as any).positionAmongstSiblings();
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        sourcePosition = Math.floor(value);
      }
    }
  } catch (error) {
    console.warn('[agent-remnote][move] failed to get source position', { error });
  }

  if (moveToStandalone) {
    if (typeof (rem as any).setParent === 'function') {
      await (rem as any).setParent(null);
    } else {
      throw new Error('Standalone move requires Rem.setParent(null) support');
    }
  } else {
    await plugin.rem.moveRems([remId], newParentId, typeof position === 'number' ? position : 0);
  }

  if (is_document === true && typeof (rem as any).setIsDocument === 'function') {
    await (rem as any).setIsDocument(true);
  }

  const warnings: string[] = [];
  const nextActions: string[] = [];
  let portalId: string | undefined;

  if (leave_portal === true) {
    if (!sourceParentId) {
      warnings.push('Move succeeded, but leave-portal could not determine the source parent');
      nextActions.push(`agent-remnote --json portal create --parent <sourceParentId> --target ${remId}`);
    } else {
      const portal = await plugin.rem.createPortal().catch((error) => {
        warnings.push(`Move succeeded, but leave-portal failed: ${String((error as any)?.message || error)}`);
        return null;
      });

      if (portal?._id) {
        try {
          await plugin.rem.moveRems([portal._id], sourceParentId, sourcePosition);
          await (rem as any).addToPortal(portal._id);
          portalId = portal._id;
        } catch (error) {
          try {
            await portal.remove();
          } catch {}
          warnings.push(`Move succeeded, but leave-portal failed: ${String((error as any)?.message || error)}`);
          nextActions.push(`agent-remnote --json portal create --parent ${sourceParentId} --target ${remId}`);
        }
      }
    }
  }

  return {
    ok: true,
    rem_id: remId,
    ...(moveToStandalone ? { standalone: true } : { new_parent_id: newParentId }),
    ...(leave_portal === true ? { leave_portal: true, portal_created: Boolean(portalId) } : {}),
    ...(sourceParentId ? { source_parent_id: sourceParentId } : {}),
    ...(portalId ? { portal_id: portalId } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(nextActions.length > 0 ? { nextActions } : {}),
  };
}

export async function executeDeleteRem(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  return executeDeleteWithSafeSubtree(plugin, op, {
    errorContext: 'rem deletion',
    includeRemIdInSuccess: false,
  });
}

export async function executeDeleteBackupArtifact(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  return executeDeleteWithSafeSubtree(plugin, op, {
    errorContext: 'backup deletion',
    includeRemIdInSuccess: true,
  });
}
