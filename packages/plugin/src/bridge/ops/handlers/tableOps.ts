import type { ReactRNPlugin } from '@remnote/plugin-sdk';

import { attachNewRem } from '../../remnote/attachNewRem';
import { buildQuery } from '../../remnote/queryBuilder';
import { toRichText } from '../../remnote/richText';

import type { OpDispatch } from '../types';

async function findRemByIdRobust(plugin: ReactRNPlugin, remId: string): Promise<any | undefined> {
  const id = typeof remId === 'string' ? remId.trim() : '';
  if (!id) return undefined;

  try {
    const rem = await plugin.rem.findOne(id);
    if (rem) return rem;
  } catch {}

  try {
    const rems = await plugin.rem.findMany([id]);
    if (Array.isArray(rems)) {
      const found = rems.find((rem: any) => rem?._id === id);
      if (found) return found;
    }
  } catch {}

  try {
    const rems = await plugin.rem.getAll();
    if (Array.isArray(rems)) {
      return rems.find((rem: any) => rem?._id === id);
    }
  } catch {}

  return undefined;
}

function createUnsupportedPropertyTypeMutationError(propertyId: unknown): Error {
  return new Error(
    `Property type mutation is unsupported by the current RemNote plugin runtime: public rem.setPropertyType() is unavailable, and host endpoints rem.setPropertyType/rem.setSlotType are not exposed for ${String(propertyId ?? 'unknown-property')}`,
  );
}

export async function executeCreateTable(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { tag_id, client_temp_id, parent_id, position } = op.payload || {};
  const parentId = typeof parent_id === 'string' ? parent_id.trim() : '';
  if (!parentId) throw new Error('Missing parent_id (refusing to create a Rem without a parent)');
  const rem = await plugin.rem.createTable(tag_id);
  if (!rem) throw new Error('createTable returned null');
  try {
    const pos = typeof position === 'number' && Number.isFinite(position) && position >= 0 ? Math.floor(position) : 0;
    await plugin.rem.moveRems([rem._id], parentId, pos);
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

export async function executeAddProperty(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { tag_id, name, property_id, type, options } = op.payload || {};
  const tagRem = await plugin.rem.findOne(tag_id);
  if (!tagRem) throw new Error('tag_rem not found');
  const prop = await plugin.rem.createRem();
  if (!prop) throw new Error('createRem returned null');
  try {
    await attachNewRem(plugin, prop, tagRem._id, 0);
    // @ts-ignore
    await prop.setText(toRichText(name ?? 'Property'));
    if ((prop as any).setIsProperty) await (prop as any).setIsProperty(true);
    if (type) {
      if (typeof (prop as any).setPropertyType === 'function') {
        await (prop as any).setPropertyType(type);
      } else {
        throw createUnsupportedPropertyTypeMutationError((prop as any)?._id ?? property_id);
      }
    }
    if (Array.isArray(options) && options.length > 0) {
      for (const opt of options) {
        const optRem = await plugin.rem.createRem();
        if (!optRem) throw new Error('createRem returned null');
        await attachNewRem(plugin, optRem, (prop as any)._id, 0);
        // @ts-ignore
        await optRem.setText(toRichText(opt));
      }
    }
  } catch (e) {
    try {
      await prop.remove();
    } catch {}
    throw e;
  }
  const result: any = { ok: true };
  if (property_id && prop._id) {
    result.created = { client_temp_id: property_id, remote_id: prop._id, remote_type: 'property' };
  }
  return result;
}

export async function executeSetPropertyType(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { property_id, type } = op.payload || {};
  const prop = await findRemByIdRobust(plugin, property_id);
  if (!prop) throw new Error('property rem not found');
  if (typeof (prop as any).setPropertyType === 'function') {
    await (prop as any).setPropertyType(type);
    return { ok: true };
  }
  throw createUnsupportedPropertyTypeMutationError(property_id ?? (prop as any)?._id);
}

export async function executeSetTableFilter(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { table_id, column_id, contains_text, expr } = op.payload || {};
  const table = await plugin.rem.findOne(table_id);
  if (!table) throw new Error('table rem not found');
  if (typeof (table as any).setTableFilter !== 'function') return { ok: false };
  const sdk: any = await import('@remnote/plugin-sdk');
  const Query = sdk.Query;
  const TextMatcher = sdk.TextMatcher;
  const NumberMatcher = sdk.NumberMatcher;
  const DateMatcher = sdk.DateMatcher;
  const SingleSelectMatcher = sdk.SingleSelectMatcher;
  const MultiSelectMatcher = sdk.MultiSelectMatcher;
  const CheckboxMatcher = sdk.CheckboxMatcher;
  let q: any = null;
  if (expr) {
    q = buildQuery(
      {
        Query,
        TextMatcher,
        NumberMatcher,
        DateMatcher,
        SingleSelectMatcher,
        MultiSelectMatcher,
        CheckboxMatcher,
      },
      expr,
    );
  } else if (column_id && contains_text) {
    if (!Query || !TextMatcher) return { ok: false };
    q = Query.tableColumn(column_id, Query.text(TextMatcher.Contains, String(contains_text)));
  }
  if (!q) return { ok: false };
  await (table as any).setTableFilter(q);
  return { ok: true };
}

export async function executeAddOption(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { property_id, text, option_id } = op.payload || {};
  const prop = await findRemByIdRobust(plugin, property_id);
  if (!prop) throw new Error('property rem not found');
  const opt = await plugin.rem.createRem();
  if (!opt) throw new Error('createRem returned null');
  try {
    await attachNewRem(plugin, opt, (prop as any)._id, 0);
    // @ts-ignore
    await opt.setText(toRichText(text));
  } catch (e) {
    try {
      await opt.remove();
    } catch {}
    throw e;
  }
  const result: any = { ok: true };
  if (option_id && opt._id) {
    result.created = { client_temp_id: option_id, remote_id: opt._id, remote_type: 'option' };
  }
  return result;
}

export async function executeRemoveOption(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { option_id } = op.payload || {};
  const opt = await findRemByIdRobust(plugin, option_id);
  if (!opt) return { ok: true };
  await opt.remove();
  return { ok: true };
}

export async function executeTableAddRow(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { table_tag_id, rem_id, text, parent_id, client_temp_id, values, extra_tags } = op.payload || {};
  let row = rem_id ? await plugin.rem.findOne(rem_id) : undefined;
  const created = !row;
  if (!row) {
    row = await plugin.rem.createRem();
    if (!row) throw new Error('createRem returned null');
    const parentId = typeof parent_id === 'string' ? parent_id.trim() : '';
    if (!parentId) throw new Error('Missing parent_id (refusing to create a Rem without a parent)');
    try {
      await attachNewRem(plugin, row, parentId, 0);
      if (text !== undefined) {
        // @ts-ignore
        await row.setText(toRichText(text));
      }
    } catch (e) {
      try {
        await row.remove();
      } catch {}
      throw e;
    }
  }
  const rollback = async () => {
    if (!created) return;
    try {
      await row.remove();
    } catch {}
  };
  try {
    // @ts-ignore
    await row.addTag(table_tag_id);
    if (Array.isArray(extra_tags)) {
      for (const t of extra_tags) {
        // @ts-ignore
        await row.addTag(t);
      }
    }
    if (Array.isArray(values)) {
      for (const v of values) {
        // @ts-ignore
        await row.setTagPropertyValue(v.property_id, toRichText(v.value));
      }
    }
  } catch (e) {
    await rollback();
    throw e;
  }
  const result: any = { ok: true };
  if (!rem_id && client_temp_id && row?._id) {
    result.created = { client_temp_id, remote_id: row._id, remote_type: 'row' };
  }
  return result;
}

export async function executeTableRemoveRow(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { table_tag_id, rem_id, remove_properties } = op.payload || {};
  const row = await plugin.rem.findOne(rem_id);
  if (!row) return { ok: true };
  // @ts-ignore
  await row.removeTag(table_tag_id, !!remove_properties);
  return { ok: true };
}

export async function executeSetCellSelect(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { rem_id, property_id, option_ids } = op.payload || {};
  const row = await plugin.rem.findOne(rem_id);
  if (!row) throw new Error('Rem not found');
  const ids: string[] = Array.isArray(option_ids) ? option_ids : [option_ids];
  const tokens = ids.filter(Boolean).map((id) => ({ i: 'q', _id: id }));
  // @ts-ignore
  await row.setTagPropertyValue(property_id, tokens);
  return { ok: true };
}

export async function executeSetCellCheckbox(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { rem_id, property_id, value } = op.payload || {};
  const row = await plugin.rem.findOne(rem_id);
  if (!row) throw new Error('Rem not found');
  // @ts-ignore
  await row.setTagPropertyValue(property_id, [{ i: 'm', text: value ? 'Yes' : 'No' }]);
  return { ok: true };
}

export async function executeSetCellNumber(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { rem_id, property_id, value } = op.payload || {};
  const row = await plugin.rem.findOne(rem_id);
  if (!row) throw new Error('Rem not found');
  // Numbers are stored as strings in value tokens.
  // @ts-ignore
  await row.setTagPropertyValue(property_id, [{ i: 'm', text: String(value) }]);
  return { ok: true };
}

export async function executeSetCellDate(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { rem_id, property_id, value } = op.payload || {};
  const row = await plugin.rem.findOne(rem_id);
  if (!row) throw new Error('Rem not found');
  let date: Date | null = null;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) date = d;
  } else if (value && typeof value === 'object' && value.year && value.month && value.day) {
    const d = new Date(value.year, value.month - 1, value.day);
    if (!isNaN(d.getTime())) date = d;
  }
  if (!date) throw new Error('Invalid date');
  // @ts-ignore
  const daily = await plugin.date.getDailyDoc(date);
  if (!daily?._id) throw new Error('Daily document not found for that date. Please open it in RemNote first.');
  // @ts-ignore
  await row.setTagPropertyValue(property_id, [{ i: 'q', _id: daily._id }]);
  return { ok: true };
}
