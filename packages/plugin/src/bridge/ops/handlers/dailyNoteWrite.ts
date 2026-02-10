import type { ReactRNPlugin } from '@remnote/plugin-sdk';

import { createSingleRemWithMarkdownAndFixRefs, createTreeWithMarkdownAndFixRefs } from '../../remnote/markdown';
import { toRichText } from '../../remnote/richText';

import type { OpDispatch } from '../types';

function normalizeText(x: unknown): string {
  return typeof x === 'string' ? x.trim() : '';
}

type BundleSpec = {
  readonly title: string;
};

function formatBundleRootText(spec: BundleSpec): string {
  const title = normalizeText(spec.title);
  return title || 'Imported (bundle)';
}

function readBundleSpec(payload: any): BundleSpec | null {
  const bundle = payload?.bundle;
  if (!bundle || typeof bundle !== 'object') return null;
  const enabled = (bundle as any).enabled === true;
  const title = normalizeText((bundle as any).title) || normalizeText(payload?.bundle_title);
  if (!enabled && !title) return null;
  return { title: title || 'Imported (bundle)' };
}

export async function executeDailyNoteWrite(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { text, markdown, date, offset_days, prepend, position } = op.payload || {};
  let target: Date | null = null;
  if (typeof date === 'string' || typeof date === 'number') {
    const d = new Date(date);
    if (!isNaN(d.getTime())) target = d;
  }
  if (!target) {
    const off = typeof offset_days === 'number' ? offset_days : 0;
    const now = new Date();
    target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
  }

  // @ts-ignore
  const daily = await plugin.date.getDailyDoc(target);
  if (!daily?._id) {
    throw new Error('Daily document not found for that date. Please open it in RemNote first.');
  }

  const positionValue =
    typeof position === 'number' && Number.isFinite(position) && position >= 0 ? Math.floor(position) : undefined;

  const bundleSpec = readBundleSpec(op.payload || {});
  if (bundleSpec) {
    const createdInner: string[] = [];
    let bundleRem: any | null = null;

    try {
      const bundleRootText = formatBundleRootText(bundleSpec);
      try {
        bundleRem = await createSingleRemWithMarkdownAndFixRefs(plugin, bundleRootText, daily._id);
        if (!bundleRem?._id) throw new Error('createSingleRemWithMarkdown returned null for bundle title');
      } catch {
        bundleRem = await plugin.rem.createRem();
        if (!bundleRem?._id) throw new Error('createRem failed for bundle title');
        // @ts-ignore
        await bundleRem.setText(toRichText(bundleRootText));
      }

      const bundlePos =
        positionValue !== undefined ? positionValue : typeof prepend === 'boolean' && prepend ? 0 : 999999;
      try {
        await plugin.rem.moveRems([bundleRem._id], daily._id, bundlePos);
      } catch (e) {
        try {
          await bundleRem.remove();
        } catch {}
        throw e;
      }

      if (typeof markdown === 'string' && markdown.trim()) {
        try {
          const res = await createTreeWithMarkdownAndFixRefs(plugin, markdown, bundleRem._id);
          if (Array.isArray(res)) {
            for (const r of res) if (r?._id) createdInner.push(r._id);
          }
        } catch {
          const child = await createSingleRemWithMarkdownAndFixRefs(plugin, markdown, bundleRem._id);
          if (child?._id) createdInner.push(child._id);
        }
      } else if (text != null) {
        const child = await plugin.rem.createRem();
        if (!child) throw new Error('createRem failed');
        try {
          // @ts-ignore
          await child.setText(toRichText(text));
        } catch (e) {
          try {
            await child.remove();
          } catch {}
          throw e;
        }
        try {
          await plugin.rem.moveRems([child._id], bundleRem._id, 999999);
        } catch (e) {
          try {
            await child.remove();
          } catch {}
          throw e;
        }
        if (child?._id) createdInner.push(child._id);
      } else {
        throw new Error('Missing content (text/markdown)');
      }

      return {
        ok: true,
        daily_id: daily._id,
        created_ids: [bundleRem._id],
        bundle: { rem_id: bundleRem._id },
        bundle_inner_created_ids: createdInner.length ? createdInner : undefined,
      };
    } catch (e) {
      if (bundleRem?._id) {
        try {
          await bundleRem.remove();
        } catch {}
      }
      throw e;
    }
  }

  const created: string[] = [];
  if (typeof markdown === 'string' && markdown.trim()) {
    try {
      const res = await createTreeWithMarkdownAndFixRefs(plugin, markdown, daily._id);
      if (Array.isArray(res)) {
        for (const r of res) if (r?._id) created.push(r._id);
      }
    } catch {
      const child = await createSingleRemWithMarkdownAndFixRefs(plugin, markdown, daily._id);
      if (child?._id) created.push(child._id);
    }
  } else if (text != null) {
    const child = await plugin.rem.createRem();
    if (!child) throw new Error('createRem failed');
    try {
      // @ts-ignore
      await child.setText(toRichText(text));
    } catch (e) {
      try {
        await child.remove();
      } catch {}
      throw e;
    }
    try {
      await plugin.rem.moveRems([child._id], daily._id, typeof prepend === 'boolean' && prepend ? 0 : 999999);
    } catch (e) {
      try {
        await child.remove();
      } catch {}
      throw e;
    }
    if (child?._id) created.push(child._id);
  } else {
    throw new Error('Missing content (text/markdown)');
  }

  return { ok: true, daily_id: daily._id, created_ids: created };
}
