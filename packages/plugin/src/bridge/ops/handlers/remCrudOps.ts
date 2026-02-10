import type { ReactRNPlugin } from '@remnote/plugin-sdk';

import { toRichText } from '../../remnote/richText';

import type { OpDispatch } from '../types';

export async function executeCreateRem(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { parent_id, text, tags, is_document, client_temp_id, position } = op.payload || {};
  const parentId = typeof parent_id === 'string' ? parent_id.trim() : '';
  if (!parentId) throw new Error('Missing parent_id (refusing to create a Rem without a parent)');
  const rem = await plugin.rem.createRem();
  if (!rem) throw new Error('createRem returned null');

  const rollback = async () => {
    try {
      await rem.remove();
    } catch {}
  };

  try {
    const pos = typeof position === 'number' && Number.isFinite(position) && position >= 0 ? Math.floor(position) : 0;
    await plugin.rem.moveRems([rem._id], parentId, pos);

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
  const { rem_id, new_parent_id, position } = op.payload || {};
  if (!rem_id || !new_parent_id) throw new Error('Missing rem_id/new_parent_id');
  await plugin.rem.moveRems([rem_id], new_parent_id, typeof position === 'number' ? position : 0);
  return { ok: true };
}

export async function executeDeleteRem(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { rem_id } = op.payload || {};
  const rem = await plugin.rem.findOne(rem_id);
  if (!rem) return { ok: true };
  await rem.remove();
  return { ok: true };
}
