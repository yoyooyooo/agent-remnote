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

export async function executeAddTagBulk(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const items = Array.isArray(op.payload?.items) ? op.payload.items : [];
  if (items.length === 0) throw new Error('Missing items');

  const item_results: Array<{ rem_id: string; tag_id: string }> = [];
  for (const item of items) {
    const rem_id = item?.rem_id;
    const tag_id = item?.tag_id;
    if (!rem_id || !tag_id) throw new Error('Missing rem_id/tag_id');
    const rem = await plugin.rem.findOne(rem_id);
    if (!rem) throw new Error(`Rem not found: ${rem_id}`);
    // @ts-ignore
    await rem.addTag(tag_id);
    item_results.push({ rem_id, tag_id });
  }

  return { ok: true, item_results, changed_count: item_results.length };
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

export async function executeRemoveTagBulk(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const items = Array.isArray(op.payload?.items) ? op.payload.items : [];
  const remove_properties = !!op.payload?.remove_properties;
  if (items.length === 0) throw new Error('Missing items');

  const item_results: Array<{ rem_id: string; tag_id: string }> = [];
  for (const item of items) {
    const rem_id = item?.rem_id;
    const tag_id = item?.tag_id;
    if (!rem_id || !tag_id) throw new Error('Missing rem_id/tag_id');
    const rem = await plugin.rem.findOne(rem_id);
    if (!rem) throw new Error(`Rem not found: ${rem_id}`);
    // @ts-ignore
    await rem.removeTag(tag_id, remove_properties);
    item_results.push({ rem_id, tag_id });
  }

  return { ok: true, item_results, changed_count: item_results.length, ...(remove_properties ? { remove_properties: true } : {}) };
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

export async function executeAddSourceBulk(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const items = Array.isArray(op.payload?.items) ? op.payload.items : [];
  if (items.length === 0) throw new Error('Missing items');

  const item_results: Array<{ rem_id: string; source_id: string }> = [];
  for (const item of items) {
    const rem_id = item?.rem_id;
    const source_id = item?.source_id;
    const rem = await plugin.rem.findOne(rem_id);
    if (!rem) throw new Error('Rem not found');
    // @ts-ignore
    await rem.addSource(source_id);
    item_results.push({ rem_id, source_id });
  }

  return { ok: true, item_results, changed_count: item_results.length };
}

export async function executeRemoveSource(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { rem_id, source_id } = op.payload || {};
  const rem = await plugin.rem.findOne(rem_id);
  if (!rem) throw new Error('Rem not found');
  // @ts-ignore
  await rem.removeSource(source_id);
  return { ok: true };
}

export async function executeRemoveSourceBulk(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const items = Array.isArray(op.payload?.items) ? op.payload.items : [];
  if (items.length === 0) throw new Error('Missing items');

  const item_results: Array<{ rem_id: string; source_id: string }> = [];
  for (const item of items) {
    const rem_id = item?.rem_id;
    const source_id = item?.source_id;
    const rem = await plugin.rem.findOne(rem_id);
    if (!rem) throw new Error('Rem not found');
    // @ts-ignore
    await rem.removeSource(source_id);
    item_results.push({ rem_id, source_id });
  }

  return { ok: true, item_results, changed_count: item_results.length };
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

export async function executeSetTodoStatusBulk(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const items = Array.isArray(op.payload?.items) ? op.payload.items : [];
  if (items.length === 0) throw new Error('Missing items');

  const item_results: Array<{ rem_id: string; status: string }> = [];
  for (const item of items) {
    const rem_id = item?.rem_id;
    const status = item?.status;
    const rem = await plugin.rem.findOne(rem_id);
    if (!rem) throw new Error('Rem not found');
    if (typeof (rem as any).setTodoStatus === 'function') {
      await (rem as any).setTodoStatus(status);
      item_results.push({ rem_id, status });
      continue;
    }
    return { ok: false };
  }

  return { ok: true, item_results, changed_count: item_results.length };
}
