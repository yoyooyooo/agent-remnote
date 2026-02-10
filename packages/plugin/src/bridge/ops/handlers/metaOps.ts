import type { ReactRNPlugin } from '@remnote/plugin-sdk';

import { toRichText } from '../../remnote/richText';

import type { OpDispatch } from '../types';

export async function executeAddTag(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { rem_id, tag_id } = op.payload || {};
  if (!rem_id || !tag_id) throw new Error('Missing rem_id/tag_id');
  const rem = await plugin.rem.findOne(rem_id);
  if (!rem) throw new Error(`Rem not found: ${rem_id}`);
  // @ts-ignore
  await rem.addTag(tag_id);
  return { ok: true };
}

export async function executeRemoveTag(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { rem_id, tag_id, remove_properties } = op.payload || {};
  if (!rem_id || !tag_id) throw new Error('Missing rem_id/tag_id');
  const rem = await plugin.rem.findOne(rem_id);
  if (!rem) throw new Error(`Rem not found: ${rem_id}`);
  // @ts-ignore
  await rem.removeTag(tag_id, !!remove_properties);
  return { ok: true };
}

export async function executeSetAttributeOrTableCellWrite(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { rem_id, property_id, value } = op.payload || {};
  if (!rem_id || !property_id) throw new Error('Missing rem_id/property_id');
  const rem = await plugin.rem.findOne(rem_id);
  if (!rem) throw new Error(`Rem not found: ${rem_id}`);
  // @ts-ignore
  await rem.setTagPropertyValue(property_id, toRichText(value));
  return { ok: true };
}

export async function executeAddSource(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { rem_id, source_id } = op.payload || {};
  const rem = await plugin.rem.findOne(rem_id);
  if (!rem) throw new Error('Rem not found');
  // @ts-ignore
  await rem.addSource(source_id);
  return { ok: true };
}

export async function executeRemoveSource(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { rem_id, source_id } = op.payload || {};
  const rem = await plugin.rem.findOne(rem_id);
  if (!rem) throw new Error('Rem not found');
  // @ts-ignore
  await rem.removeSource(source_id);
  return { ok: true };
}

export async function executeSetTodoStatus(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { rem_id, status } = op.payload || {};
  const rem = await plugin.rem.findOne(rem_id);
  if (!rem) throw new Error('Rem not found');
  if (typeof (rem as any).setTodoStatus === 'function') {
    await (rem as any).setTodoStatus(status);
    return { ok: true };
  }
  return { ok: false };
}
