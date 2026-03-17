import { SelectionType, type ReactRNPlugin } from '@remnote/plugin-sdk';

import { sleep } from '../../shared/sleep';
import {
  createSingleRemWithMarkdownAndFixRefs,
  createTreeWithMarkdownAndFixRefs,
  importMarkdownByIndent,
  parseMarkdownBlocks,
} from '../../remnote/markdown';
import { toRichText } from '../../remnote/richText';
import { AGENT_REMNOTE_BACKUP_POWERUP } from '../../powerups';

import type { OpDispatch } from '../types';

function normalizeId(x: unknown): string {
  return typeof x === 'string' ? x.trim() : '';
}

function normalizeText(x: unknown): string {
  return typeof x === 'string' ? x.trim() : '';
}

function getParentIdOfRem(rem: any): string {
  const parent = rem?.parent;
  if (typeof parent === 'string') return parent.trim();
  const parentId = parent?._id;
  if (typeof parentId === 'string') return parentId.trim();
  return '';
}

function readRemPlainText(rem: any): string {
  const text = rem?.text;
  if (typeof text === 'string') return normalizeText(text);
  if (Array.isArray(text) && text.every((item: unknown) => typeof item === 'string')) {
    return normalizeText(text.join(''));
  }
  return '';
}

const BACKUP_TITLE_PREFIXES = [
  'agent-remnote: children replace backup (auto)',
  'agent-remnote: replace backup (auto)',
] as const;
const DEFER_DELETE_SUBTREE_NODE_THRESHOLD = 50;

async function isBackupArtifactRem(rem: any): Promise<boolean> {
  if (!rem) return false;
  try {
    if (typeof rem.hasPowerup === 'function' && (await rem.hasPowerup(AGENT_REMNOTE_BACKUP_POWERUP.code)) === true) {
      return true;
    }
  } catch {}

  const text = readRemPlainText(rem);
  return BACKUP_TITLE_PREFIXES.some((prefix) => text === prefix || text.startsWith(prefix));
}

async function partitionBackupArtifactChildren(
  plugin: ReactRNPlugin,
  childIds: readonly string[],
): Promise<{ readonly contentChildIds: readonly string[]; readonly backupChildIds: readonly string[] }> {
  const contentChildIds: string[] = [];
  const backupChildIds: string[] = [];

  for (const id of childIds) {
    try {
      const rem: any = await plugin.rem.findOne(id);
      if (await isBackupArtifactRem(rem)) backupChildIds.push(id);
      else contentChildIds.push(id);
    } catch {
      contentChildIds.push(id);
    }
  }

  return { contentChildIds, backupChildIds };
}

async function countRemTreeNodes(
  plugin: ReactRNPlugin,
  rootIds: readonly string[],
  limit: number,
): Promise<number> {
  const queue = [...rootIds];
  let count = 0;

  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) continue;
    count += 1;
    if (count > limit) return count;

    try {
      const rem: any = await plugin.rem.findOne(id);
      const children = getOrderedChildIds(rem);
      for (const childId of children) queue.push(childId);
    } catch {}
  }

  return count;
}

async function maybeHideBackupRem(params: {
  readonly rem: any;
  readonly portalId?: string | undefined;
}): Promise<boolean> {
  try {
    if (typeof params.rem?.setHiddenExplicitlyIncludedState === 'function') {
      await params.rem.setHiddenExplicitlyIncludedState('hidden', params.portalId);
      return true;
    }
  } catch {}
  return false;
}

async function applyBackupPowerupMetadata(params: {
  readonly rem: any;
  readonly backupKind: 'children_replace' | 'selection_replace';
  readonly cleanupPolicy: 'auto' | 'visible';
  readonly cleanupState: 'pending' | 'orphan' | 'retained' | 'cleaned';
  readonly op: OpDispatch;
  readonly sourceParentId: string;
  readonly sourceAnchorId: string;
}): Promise<void> {
  const rem = params.rem;
  if (!rem) return;

  try {
    if (typeof rem.addPowerup === 'function') {
      await rem.addPowerup(AGENT_REMNOTE_BACKUP_POWERUP.code);
    }
  } catch {}

  const setSlot = async (slotCode: string, value: string) => {
    try {
      if (typeof rem.setPowerupProperty === 'function') {
        await rem.setPowerupProperty(AGENT_REMNOTE_BACKUP_POWERUP.code, slotCode, [value]);
      }
    } catch {}
  };

  const createdAt = new Date().toISOString();
  await setSlot('backup_kind', params.backupKind);
  await setSlot('cleanup_policy', params.cleanupPolicy);
  await setSlot('cleanup_state', params.cleanupState);
  await setSlot('source_txn', params.op.txn_id);
  await setSlot('source_op', params.op.op_id);
  await setSlot('source_parent', params.sourceParentId);
  await setSlot('source_anchor', params.sourceAnchorId);
  await setSlot('created_at', createdAt);
}

function getOrderedChildIds(rem: any): string[] {
  if (!Array.isArray(rem?.children)) return [];
  return rem.children.filter((value: any) => typeof value === 'string' && value.trim()).map((value: string) => value.trim());
}

async function computeRootRemIdsForMove(
  plugin: ReactRNPlugin,
  created: unknown,
  createdIds: string[],
  parentId: string,
  portalId?: string,
): Promise<string[]> {
  const roots: Array<{ id: string; rem: any; index: number }> = [];

  if (Array.isArray(created)) {
    for (let i = 0; i < created.length; i += 1) {
      const r: any = created[i];
      const id = normalizeId(r?._id);
      if (!id) continue;
      if (getParentIdOfRem(r) === parentId) roots.push({ id, rem: r, index: i });
    }
  }

  if (roots.length === 0) {
    for (let i = 0; i < createdIds.length; i += 1) {
      const id = normalizeId(createdIds[i]);
      if (!id) continue;
      try {
        const r: any = await plugin.rem.findOne(id);
        if (!r) continue;
        if (getParentIdOfRem(r) === parentId) roots.push({ id, rem: r, index: i });
      } catch {}
    }
  }

  if (roots.length === 0) return [];

  const withPos: Array<{ id: string; pos: number; index: number }> = [];
  for (const r of roots) {
    let pos: any = undefined;
    try {
      if (typeof r.rem?.positionAmongstVisibleSiblings === 'function') {
        pos = await r.rem.positionAmongstVisibleSiblings(portalId);
      }
    } catch {}
    if (pos === undefined) {
      try {
        if (typeof r.rem?.positionAmongstSiblings === 'function') {
          pos = await r.rem.positionAmongstSiblings(portalId);
        }
      } catch {}
    }
    if (typeof pos === 'number' && Number.isFinite(pos) && pos >= 0) {
      withPos.push({ id: r.id, pos: Math.floor(pos), index: r.index });
    }
  }

  if (withPos.length !== roots.length) {
    // Fallback: keep creation order if position cannot be computed reliably.
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const r of roots) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      ordered.push(r.id);
    }
    return ordered;
  }

  withPos.sort((a, b) => (a.pos !== b.pos ? a.pos - b.pos : a.index - b.index));
  return withPos.map((x) => x.id);
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

function readStagedImportFlag(payload: any): boolean {
  if (!payload || typeof payload !== 'object') return false;
  if ((payload as any).staged === true) return true;
  const staging = (payload as any).staging;
  if (staging === true) return true;
  if (staging && typeof staging === 'object' && (staging as any).enabled === true) return true;
  return false;
}

export async function executeCreateSingleRemWithMarkdown(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { markdown, parent_id, client_temp_id } = op.payload || {};
  const parentId = typeof parent_id === 'string' ? parent_id.trim() : '';
  if (!parentId) throw new Error('Missing parent_id (refusing to create a Rem without a parent)');
  const rem = await createSingleRemWithMarkdownAndFixRefs(plugin, String(markdown ?? ''), parentId);
  if (!rem) throw new Error('createSingleRemWithMarkdown returned null');
  const result: any = { ok: true };
  if (client_temp_id && rem._id) result.created = { client_temp_id, remote_id: rem._id, remote_type: 'rem' };
  return result;
}

export async function executeCreateTreeWithMarkdown(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { markdown, parent_id, client_temp_ids, indent_mode, parse_mode, indent_size, prepared, position } =
    op.payload || {};
  const parentId = typeof parent_id === 'string' ? parent_id.trim() : '';
  if (!parentId) throw new Error('Missing parent_id (refusing to create a Rem without a parent)');
  const stagedRequested = readStagedImportFlag(op.payload || {});
  let staged = stagedRequested;
  const positionValue =
    typeof position === 'number' && Number.isFinite(position) && position >= 0 ? Math.floor(position) : undefined;
  const parseMode = typeof parse_mode === 'string' ? parse_mode : undefined;
  const useAst = parseMode === 'ast' || parseMode === 'prepared';
  const result: any = { ok: true };
  const md = String(markdown ?? '');

  const bundleSpec = readBundleSpec(op.payload || {});
  const bundleRootText = bundleSpec ? formatBundleRootText(bundleSpec) : '';

  let stagingRemId: string | null = null;

  let effectiveParentId = parentId;
  let bundleRem: any | null = null;

  if (stagedRequested) {
    try {
      const stagingRem = await createSingleRemWithMarkdownAndFixRefs(plugin, 'agent-remnote: staged import (auto)', parentId);
      if (!stagingRem?._id) throw new Error('createSingleRemWithMarkdown returned null for staged import container');
      stagingRemId = String(stagingRem._id);
      // Best-effort: keep the staging container out of the way (end of parent).
      try {
        await plugin.rem.moveRems([stagingRemId], parentId, 1_000_000_000);
      } catch {}
      effectiveParentId = stagingRemId;
    } catch {
      // Staged mode is a visual enhancement; fall back to normal import if we cannot create the staging container.
      if (stagingRemId) {
        try {
          const sr: any = await plugin.rem.findOne(stagingRemId);
          if (sr) await sr.remove();
        } catch {}
      }
      staged = false;
      stagingRemId = null;
      effectiveParentId = parentId;
    }
  }

  const finalizeStagedMove = async () => {
    if (!staged || !stagingRemId) return;
    const insertPos = positionValue ?? 999999;
    const latest: any = await plugin.rem.findOne(stagingRemId);
    const rootIds: string[] = Array.isArray(latest?.children)
      ? latest.children.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
      : [];
    if (rootIds.length === 0) throw new Error(`Staged import produced no root Rems (staging_rem_id=${stagingRemId})`);
    try {
      await plugin.rem.moveRems(rootIds, parentId, insertPos);
    } catch (e: any) {
      // Best-effort rollback: remove any roots that may have moved, then delete the staging container.
      try {
        for (const id of rootIds) {
          try {
            const r: any = await plugin.rem.findOne(id);
            if (!r) continue;
            if (getParentIdOfRem(r) === parentId) await r.remove();
          } catch {}
        }
      } catch {}
      try {
        const sr: any = await plugin.rem.findOne(stagingRemId);
        if (sr) await sr.remove();
      } catch {}
      throw new Error(
        `Failed to move staged content to target parent: ${String(e?.message || e)} (rolled_back=true, staging_rem_id=${stagingRemId})`,
      );
    }
    try {
      const sr: any = await plugin.rem.findOne(stagingRemId);
      if (sr) await sr.remove();
    } catch {}
  };

  if (bundleSpec) {
    try {
      bundleRem = await createSingleRemWithMarkdownAndFixRefs(plugin, bundleRootText, effectiveParentId);
      if (!bundleRem?._id) throw new Error('createSingleRemWithMarkdown returned null for bundle title');
      if (!staged && positionValue !== undefined) await plugin.rem.moveRems([bundleRem._id], parentId, positionValue);
    } catch {
      if (bundleRem?._id) {
        try {
          await bundleRem.remove();
        } catch {}
      }
      bundleRem = await plugin.rem.createRem();
      if (!bundleRem?._id) throw new Error('createRem failed for bundle title');
      // @ts-ignore
      await bundleRem.setText(toRichText(bundleRootText));
      try {
        if (staged) await plugin.rem.moveRems([bundleRem._id], effectiveParentId, 999999);
        else await plugin.rem.moveRems([bundleRem._id], parentId, positionValue ?? 999999);
      } catch (e) {
        try {
          await bundleRem.remove();
        } catch {}
        throw e;
      }
    }
    effectiveParentId = String(bundleRem._id);
  }

  // In bundle mode, `position` refers to the bundle container itself; do not re-use it for inner imports.
  const innerPositionValue = staged ? undefined : bundleSpec ? undefined : positionValue;
  // If we need stable root rem ids for "insert at position", use RemNote native importer.
  const useIndent = innerPositionValue === undefined && indent_mode !== false && !useAst && parseMode !== 'raw';

  const finalizeBundle = async () => {
    if (!bundleRem?._id) return;
    if (Array.isArray(result.created_ids)) result.bundle_inner_created_ids = result.created_ids;
    result.bundle = { rem_id: bundleRem._id };
    result.created_ids = [bundleRem._id];
  };

  try {
    if (useAst && prepared && Array.isArray(prepared.items)) {
      const blocks = prepared as any as { preface?: string; items: Array<{ heading: string; body: string }> };
      if (blocks.preface && blocks.preface.trim()) {
        try {
          await createTreeWithMarkdownAndFixRefs(plugin, blocks.preface, effectiveParentId);
        } catch {}
      }
      const id_map = [] as any[];
      for (const b of blocks.items) {
        const titleRem = await createSingleRemWithMarkdownAndFixRefs(plugin, b.heading, effectiveParentId);
        if (titleRem) {
          if (Array.isArray(client_temp_ids) && id_map.length < client_temp_ids.length) {
            const c = client_temp_ids[id_map.length];
            if (c) id_map.push({ client_temp_id: c, remote_id: titleRem._id, remote_type: 'rem' });
          }
          if (b.body && b.body.trim()) {
            try {
              await createTreeWithMarkdownAndFixRefs(plugin, b.body, titleRem._id);
            } catch {}
          }
        }
        await sleep(10);
      }
      if (id_map.length) result.id_map = id_map;
      await finalizeBundle();
      await finalizeStagedMove();
      return result;
    }

    if (useAst) {
      const blocks = await parseMarkdownBlocks(md);
      if (blocks.preface && blocks.preface.trim()) {
        try {
          await createTreeWithMarkdownAndFixRefs(plugin, blocks.preface, effectiveParentId);
        } catch {}
      }
      const id_map = [] as any[];
      for (const b of blocks.items) {
        const titleRem = await createSingleRemWithMarkdownAndFixRefs(plugin, b.heading, effectiveParentId);
        if (titleRem) {
          if (Array.isArray(client_temp_ids) && id_map.length < client_temp_ids.length) {
            const c = client_temp_ids[id_map.length];
            if (c) id_map.push({ client_temp_id: c, remote_id: titleRem._id, remote_type: 'rem' });
          }
          if (b.body && b.body.trim()) {
            try {
              await createTreeWithMarkdownAndFixRefs(plugin, b.body, titleRem._id);
            } catch {}
          }
        }
        await sleep(10);
      }
      if (id_map.length) result.id_map = id_map;
      await finalizeBundle();
      await finalizeStagedMove();
      return result;
    }

    if (useIndent) {
      const created = await importMarkdownByIndent(
        plugin,
        md,
        effectiveParentId,
        typeof indent_size === 'number' ? indent_size : 2,
      );
      const createdIds: string[] = Array.isArray(created)
        ? created.filter((value: any) => value?._id).map((value: any) => String(value._id))
        : [];
      if (createdIds.length > 0) {
        const rootIds = await computeRootRemIdsForMove(plugin, created, createdIds, effectiveParentId);
        result.created_ids = rootIds.length > 0 ? rootIds : createdIds;
      }
      if (Array.isArray(created) && Array.isArray(client_temp_ids)) {
        const id_map = [] as any[];
        for (let i = 0; i < Math.min(created.length, client_temp_ids.length); i += 1) {
          const r = created[i];
          const c = client_temp_ids[i];
          if (r && r._id && c) id_map.push({ client_temp_id: c, remote_id: r._id, remote_type: 'rem' });
        }
        if (id_map.length) result.id_map = id_map;
      }
      await finalizeBundle();
      await finalizeStagedMove();
      return result;
    }

    const rems = await createTreeWithMarkdownAndFixRefs(plugin, md, effectiveParentId);
    const createdIds: string[] = [];
    if (Array.isArray(rems)) {
      for (const r of rems) {
        if (r?._id) createdIds.push(r._id);
      }
    }
    if (createdIds.length) result.created_ids = createdIds;
    if (innerPositionValue !== undefined && createdIds.length > 0) {
      const rootIds = await computeRootRemIdsForMove(plugin, rems, createdIds, effectiveParentId);
      if (rootIds.length === 0) throw new Error('Failed to determine root Rems for moveRems');
      try {
        await plugin.rem.moveRems(rootIds, effectiveParentId, innerPositionValue);
      } catch (e) {
        // Best-effort rollback to avoid duplicated inserts on retry.
        for (const id of createdIds) {
          try {
            const rr: any = await plugin.rem.findOne(id);
            if (rr) await rr.remove();
          } catch {}
        }
        throw e;
      }
    }
    if (Array.isArray(rems) && Array.isArray(client_temp_ids)) {
      const id_map = [] as any[];
      for (let i = 0; i < Math.min(rems.length, client_temp_ids.length); i += 1) {
        const r = rems[i];
        const c = client_temp_ids[i];
        if (r?._id && c) id_map.push({ client_temp_id: c, remote_id: r._id, remote_type: 'rem' });
      }
      if (id_map.length) result.id_map = id_map;
    }
    await finalizeBundle();
    await finalizeStagedMove();
    return result;
  } catch (e) {
    if (bundleRem?._id && !staged) {
      try {
        await bundleRem.remove();
      } catch {}
    }
    if (staged && stagingRemId) {
      try {
        const sr: any = await plugin.rem.findOne(stagingRemId);
        if (sr) await sr.remove();
      } catch {}
    }
    throw e;
  }
}

export async function executeReplaceSelectionWithMarkdown(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const { markdown, target, require_same_parent, require_contiguous, portal_id, assertions } = op.payload || {};
  const backupPolicy: 'none' = 'none';
  const md = String(markdown ?? '');
  const hasMarkdown = md.trim().length > 0;

  const requireSameParent = require_same_parent !== false;
  const requireContiguous = require_contiguous !== false;
  const rawAssertions = assertions === undefined ? [] : Array.isArray(assertions) ? assertions : null;
  if (rawAssertions === null) {
    return {
      ok: false,
      fatal: true,
      error: 'replace_selection_with_markdown assertions must be an array of strings',
    };
  }
  const assertionList = rawAssertions
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  const invalidAssertion = rawAssertions.some(
    (item) => typeof item !== 'string' || !['single-root', 'no-literal-bullet'].includes(item.trim()),
  );
  if (invalidAssertion) {
    return {
      ok: false,
      fatal: true,
      error: 'replace_selection_with_markdown assertions must only include: single-root, no-literal-bullet',
    };
  }
  const assertSingleRoot = assertionList.includes('single-root');
  const assertNoLiteralBullet = assertionList.includes('no-literal-bullet');

  const rawMode = typeof target?.mode === 'string' ? target.mode : '';
  const targetMode = rawMode === 'current' ? 'current' : rawMode === 'explicit' ? 'explicit' : 'expected';
  const expectedRemIds: string[] = Array.isArray(target?.rem_ids)
    ? (target.rem_ids as any[]).map((x: any) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean)
    : [];
  if (targetMode !== 'current' && expectedRemIds.length === 0) {
    return { ok: false, fatal: true, error: `${targetMode} mode requires target.rem_ids` };
  }

  const portalIdFromPayload = typeof portal_id === 'string' ? portal_id.trim() : '';
  let portalId = portalIdFromPayload || undefined;
  if (!portalId) {
    try {
      const focused = await plugin.focus.getFocusedPortal();
      if (focused?._id) portalId = String(focused._id);
    } catch {}
  }

  let currentRemIds: string[] = [];
  if (targetMode !== 'explicit') {
    try {
      const sel: any = await plugin.editor.getSelection();
      if (!sel?.type || sel.type !== SelectionType.Rem) {
        return {
          ok: false,
          fatal: true,
          error: `Current selectionType=${sel?.type ?? 'None'}; only Rem selection is supported`,
        };
      }
      currentRemIds = Array.isArray(sel.remIds)
        ? sel.remIds.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
        : [];
    } catch {
      return { ok: false, fatal: true, error: 'Failed to read current selection' };
    }
  }
  if (targetMode !== 'explicit' && currentRemIds.length === 0) return { ok: false, fatal: true, error: 'No Rem is selected' };

  const sameSet = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const sa = new Set(a);
    const sb = new Set(b);
    if (sa.size !== sb.size) return false;
    for (const x of sa) if (!sb.has(x)) return false;
    return true;
  };

  if (targetMode === 'expected' && !sameSet(currentRemIds, expectedRemIds)) {
    return {
      ok: false,
      fatal: true,
      error: `Selection changed (expected=${expectedRemIds.length}, current=${currentRemIds.length})`,
    };
  }

  const targetRemIds: string[] = targetMode === 'current' ? currentRemIds : expectedRemIds;
  const uniqRemIds: string[] = Array.from(new Set(targetRemIds));

  const rems = await Promise.all(uniqRemIds.map((id) => plugin.rem.findOne(id)));
  const missing = uniqRemIds.filter((_, i) => !rems[i]);
  if (missing.length > 0) {
    return {
      ok: false,
      fatal: true,
      error: `Cannot access Rems (permission/deleted): ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`,
    };
  }

  const parentIds = new Set<string>();
  for (const r of rems) {
    const pid = r?.parent;
    if (typeof pid === 'string' && pid.trim()) parentIds.add(pid.trim());
  }
  if (requireSameParent && parentIds.size !== 1) {
    return {
      ok: false,
      fatal: true,
      error: `Selected Rems do not share the same parent (parents=${Array.from(parentIds).length}); cannot replace in place`,
    };
  }
  const parentId = parentIds.size === 1 ? Array.from(parentIds)[0]! : '';
  if (!parentId)
    return { ok: false, fatal: true, error: 'Cannot determine parentId (top-level Rems are not supported)' };

  const positions: number[] = [];
  for (const r of rems) {
    let pos: any = undefined;
    try {
      if (typeof (r as any)?.positionAmongstVisibleSiblings === 'function') {
        pos = await (r as any).positionAmongstVisibleSiblings(portalId);
      }
    } catch {}
    if (pos === undefined) {
      try {
        if (typeof (r as any)?.positionAmongstSiblings === 'function') {
          pos = await (r as any).positionAmongstSiblings(portalId);
        }
      } catch {}
    }
    if (typeof pos !== 'number' || !Number.isFinite(pos) || pos < 0) {
      return { ok: false, fatal: true, error: 'Failed to compute selection position' };
    }
    positions.push(Math.floor(pos));
  }
  const oldEntries: Array<{ id: string; pos: number }> = [];
  for (let i = 0; i < uniqRemIds.length; i += 1) {
    oldEntries.push({ id: uniqRemIds[i]!, pos: positions[i]! });
  }
  oldEntries.sort((a, b) => a.pos - b.pos);
  const sorted = oldEntries.map((x) => x.pos);
  const orderedOldIds = oldEntries.map((x) => x.id);
  const position = sorted[0] ?? 0;

  if (requireContiguous) {
    for (let i = 0; i < sorted.length; i += 1) {
      if (sorted[i] !== position + i) {
        return {
          ok: false,
          fatal: true,
          error: 'Selection is not contiguous (use Shift to select a contiguous block)',
        };
      }
    }
  }

  const createdIds: string[] = [];
  let createdRootIds: string[] = [];
  let created: unknown = undefined;
  const rollbackCreated = async () => {
    for (const id of createdIds) {
      try {
        const rr = await plugin.rem.findOne(id);
        if (rr) await rr.remove();
      } catch {}
    }
  };
  if (hasMarkdown) {
    created = await createTreeWithMarkdownAndFixRefs(plugin, md, parentId);
    if (Array.isArray(created)) {
      for (const r of created) {
        if (r?._id) createdIds.push(r._id);
      }
    }
    if (createdIds.length === 0)
      return { ok: false, fatal: true, error: 'createTreeWithMarkdown returned no created Rems' };
    createdRootIds = await computeRootRemIdsForMove(plugin, created, createdIds, parentId, portalId);
    if (createdRootIds.length === 0) {
      await rollbackCreated();
      return { ok: false, fatal: true, error: 'Failed to determine root Rems for moveRems' };
    }
  }

  if (hasMarkdown && assertSingleRoot && createdRootIds.length !== 1) {
    await rollbackCreated();
    return {
      ok: false,
      fatal: true,
      error: `Assertion failed: single-root (created_roots=${createdRootIds.length})`,
      assertion: 'single-root',
    };
  }
  if (hasMarkdown && assertNoLiteralBullet && createdRootIds.length === 1) {
    try {
      const createdRem: any = await plugin.rem.findOne(createdRootIds[0]);
      const plainText = readRemPlainText(createdRem);
      if (/^\s*(?:[-*+]|\d+\.)\s+/.test(plainText)) {
        await rollbackCreated();
        return {
          ok: false,
          fatal: true,
          error: 'Assertion failed: no-literal-bullet',
          assertion: 'no-literal-bullet',
        };
      }
    } catch {
      await rollbackCreated();
      return {
        ok: false,
        fatal: true,
        error: 'Assertion failed: no-literal-bullet',
        assertion: 'no-literal-bullet',
      };
    }
  }

  if (hasMarkdown) {
    try {
      if (portalId) {
        await plugin.rem.moveRems(createdRootIds, parentId, position, portalId);
      } else {
        await plugin.rem.moveRems(createdRootIds, parentId, position);
      }
    } catch (e: any) {
      await rollbackCreated();
      return { ok: false, fatal: true, error: `Failed to move new content: ${String(e?.message || e)}` };
    }
  }

  // Move old content into a temporary backup container first (reversible), then delete last.
  let backupRemId: string | null = null;
  try {
    const backup = await plugin.rem.createSingleRemWithMarkdown('agent-remnote: replace backup (auto)', parentId);
    if (!backup?._id) throw new Error('createSingleRemWithMarkdown returned null');
    backupRemId = String(backup._id);
    await applyBackupPowerupMetadata({
      rem: backup,
      backupKind: 'selection_replace',
      cleanupPolicy: 'auto',
      cleanupState: 'pending',
      op,
      sourceParentId: parentId,
      sourceAnchorId: orderedOldIds[0] ?? '',
    });
    // Best-effort: move backup container to end to minimize disruption if cleanup fails.
    try {
      if (portalId) await plugin.rem.moveRems([backupRemId], parentId, 1_000_000_000, portalId);
      else await plugin.rem.moveRems([backupRemId], parentId, 1_000_000_000);
    } catch {}
    // Move old rems under backup as a block to preserve order; if this fails, rollback new content and restore best-effort.
    if (portalId) await plugin.rem.moveRems(orderedOldIds, backupRemId, 0, portalId);
    else await plugin.rem.moveRems(orderedOldIds, backupRemId, 0);
  } catch (e: any) {
    await rollbackCreated();
    // Best-effort: restore any old rems that may have moved into the backup container.
    if (backupRemId) {
      try {
        const movedBack: string[] = [];
        for (const id of orderedOldIds) {
          try {
            const r: any = await plugin.rem.findOne(id);
            if (!r) continue;
            if (getParentIdOfRem(r) === backupRemId) movedBack.push(id);
          } catch {}
        }
        if (movedBack.length > 0) {
          try {
            if (portalId) await plugin.rem.moveRems(movedBack, parentId, position, portalId);
            else await plugin.rem.moveRems(movedBack, parentId, position);
          } catch {}
        }
      } catch {}
      try {
        const br: any = await plugin.rem.findOne(backupRemId);
        if (br) await br.remove();
      } catch {}
    }
    return {
      ok: false,
      fatal: true,
      error: `Failed to move old content to backup: ${String(e?.message || e)}`,
      backup_policy: backupPolicy,
    };
  }

  let backupDeleted = false;
  if (backupRemId) {
    try {
      const br: any = await plugin.rem.findOne(backupRemId);
      if (br) await br.remove();
      backupDeleted = true;
      backupRemId = null;
    } catch {
      backupDeleted = false;
    }
  }

  if (!backupDeleted && backupRemId) {
    // Strong semantics: do not leave backup containers behind. Roll back to the original state.
    try {
      await rollbackCreated();
    } catch {}
    let movedBack = false;
    try {
      if (portalId) await plugin.rem.moveRems(orderedOldIds, parentId, position, portalId);
      else await plugin.rem.moveRems(orderedOldIds, parentId, position);
      movedBack = true;
    } catch {}
    if (movedBack) {
      try {
        const stillInBackup: string[] = [];
        for (const id of orderedOldIds) {
          try {
            const r: any = await plugin.rem.findOne(id);
            if (!r) continue;
            if (getParentIdOfRem(r) === backupRemId) stillInBackup.push(id);
          } catch {}
        }
        if (stillInBackup.length === 0) {
          const br: any = await plugin.rem.findOne(backupRemId);
          if (br) await br.remove();
          backupRemId = null;
        }
      } catch {}
    }
    return {
      ok: false,
      fatal: true,
      error: 'Failed to delete replace backup container; rolled back to original content',
      rolled_back: true,
      backup_rem_id: backupRemId,
      backup_policy: backupPolicy,
    };
  }

  return {
    ok: true,
    target_mode: targetMode,
    parent_id: parentId,
    portal_id: portalId ?? null,
    position,
    selection_rem_ids: uniqRemIds,
    created_ids: createdIds,
    deleted_rem_ids: orderedOldIds,
    backup_deleted: backupDeleted,
    backup_rem_id: backupRemId,
    backup_policy: backupPolicy,
  };
}

export async function executeReplaceChildrenWithMarkdown(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const {
    parent_id,
    markdown,
    indent_mode,
    indent_size,
    parse_mode,
    prepared,
    staged,
    bundle,
    backup,
    assertions,
  } = op.payload || {};
  const parentId = normalizeId(parent_id);
  if (!parentId) return { ok: false, fatal: true, error: 'Missing parent_id' };
  const backupPolicy = typeof backup === 'string' && backup.trim() === 'visible' ? 'visible' : 'none';
  const assertionList = Array.isArray(assertions)
    ? assertions.filter((item: unknown) => typeof item === 'string').map((item: string) => item.trim()).filter(Boolean)
    : [];
  const assertSingleRoot = assertionList.includes('single-root');
  const assertNoLiteralBullet = assertionList.includes('no-literal-bullet');

  const parentRem: any = await plugin.rem.findOne(parentId);
  if (!parentRem) return { ok: false, fatal: true, error: `Rem not found: ${parentId}` };

  const allOldChildIds = getOrderedChildIds(parentRem);
  const { contentChildIds, backupChildIds } = await partitionBackupArtifactChildren(plugin, allOldChildIds);
  const oldChildIds = [...contentChildIds];
  const oldChildIdSet = new Set(allOldChildIds);
  const md = String(markdown ?? '');
  let createdIds: string[] = [];
  let createdRootIds: string[] = [];

  const rollbackCreated = async () => {
    for (const id of createdIds) {
      try {
        const rem: any = await plugin.rem.findOne(id);
        if (rem) await rem.remove();
      } catch {}
    }
    createdIds = [];
  };

  if (md.trim()) {
    const result = await executeCreateTreeWithMarkdown(plugin, {
      ...op,
      payload: {
        parent_id: parentId,
        markdown: md,
        position: 0,
        ...(typeof indent_mode === 'boolean' ? { indent_mode } : {}),
        ...(typeof indent_size === 'number' ? { indent_size } : {}),
        ...(typeof parse_mode === 'string' ? { parse_mode } : {}),
        ...(prepared !== undefined ? { prepared } : {}),
        ...(staged === true ? { staged: true } : {}),
        ...(bundle && typeof bundle === 'object' ? { bundle } : {}),
      },
    });
    createdIds = Array.isArray(result?.created_ids)
      ? result.created_ids.filter((value: any) => typeof value === 'string' && value.trim()).map((value: string) => value.trim())
      : [];
    if (createdIds.length === 0) {
      try {
        const latestParent: any = await plugin.rem.findOne(parentId);
        createdIds = getOrderedChildIds(latestParent).filter((id) => !oldChildIdSet.has(id));
      } catch {}
    }
    try {
      const latestParent: any = await plugin.rem.findOne(parentId);
      createdRootIds = getOrderedChildIds(latestParent).filter((id) => !oldChildIdSet.has(id));
    } catch {}
  }

  if (md.trim()) {
    if (assertSingleRoot && createdRootIds.length !== 1) {
      await rollbackCreated();
      return {
        ok: false,
        fatal: true,
        error: `Assertion failed: single-root (created_roots=${createdRootIds.length})`,
        assertion: 'single-root',
      };
    }
    if (assertNoLiteralBullet && createdRootIds.length === 1) {
      try {
        const createdRem: any = await plugin.rem.findOne(createdRootIds[0]);
        const plainText = readRemPlainText(createdRem);
        if (/^\s*(?:[-*+]|\d+\.)\s+/.test(plainText)) {
          await rollbackCreated();
          return {
            ok: false,
            fatal: true,
            error: 'Assertion failed: no-literal-bullet',
            assertion: 'no-literal-bullet',
          };
        }
      } catch {
        await rollbackCreated();
        return {
          ok: false,
          fatal: true,
          error: 'Assertion failed: no-literal-bullet',
          assertion: 'no-literal-bullet',
        };
      }
    }
  }

  if (oldChildIds.length === 0) {
    return {
      ok: true,
      parent_id: parentId,
      created_ids: createdIds,
      deleted_rem_ids: [],
      ignored_backup_rem_ids: backupChildIds,
      backup_deleted: true,
      backup_rem_id: null,
      backup_policy: backupPolicy,
    };
  }

  let backupRemId: string | null = null;
  try {
    const backup = await plugin.rem.createSingleRemWithMarkdown('agent-remnote: children replace backup (auto)', parentId);
    if (!backup?._id) throw new Error('createSingleRemWithMarkdown returned null');
    backupRemId = String(backup._id);
    await applyBackupPowerupMetadata({
      rem: backup,
      backupKind: 'children_replace',
      cleanupPolicy: backupPolicy === 'visible' ? 'visible' : 'auto',
      cleanupState: backupPolicy === 'visible' ? 'retained' : 'pending',
      op,
      sourceParentId: parentId,
      sourceAnchorId: parentId,
    });
    try {
      await plugin.rem.moveRems([backupRemId], parentId, 1_000_000_000);
    } catch {}
    await plugin.rem.moveRems(oldChildIds, backupRemId, 0);
  } catch (e: any) {
    await rollbackCreated();
    if (backupRemId) {
      try {
        const movedBack: string[] = [];
        for (const id of oldChildIds) {
          try {
            const rem: any = await plugin.rem.findOne(id);
            if (rem && getParentIdOfRem(rem) === backupRemId) movedBack.push(id);
          } catch {}
        }
        if (movedBack.length > 0) {
          try {
            await plugin.rem.moveRems(movedBack, parentId, 0);
          } catch {}
        }
      } catch {}
      try {
        const stillInBackup: string[] = [];
        for (const id of oldChildIds) {
          try {
            const rem: any = await plugin.rem.findOne(id);
            if (rem && getParentIdOfRem(rem) === backupRemId) stillInBackup.push(id);
          } catch {}
        }
        if (stillInBackup.length === 0) {
          const backupRem: any = await plugin.rem.findOne(backupRemId);
          if (backupRem) await backupRem.remove();
        }
      } catch {}
    }
    return {
      ok: false,
      fatal: true,
      error: `Failed to move old children to backup: ${String(e?.message || e)}`,
      backup_rem_id: backupRemId,
      backup_policy: backupPolicy,
    };
  }

  if (backupPolicy === 'visible') {
    return {
      ok: true,
      parent_id: parentId,
      created_ids: createdIds,
      deleted_rem_ids: oldChildIds,
      ignored_backup_rem_ids: backupChildIds,
      backup_deleted: false,
      backup_rem_id: backupRemId,
      backup_policy: backupPolicy,
    };
  }

  let backupDeleted = false;
  if (backupRemId && backupPolicy === 'none') {
    const nodeCount = await countRemTreeNodes(plugin, [backupRemId], DEFER_DELETE_SUBTREE_NODE_THRESHOLD);
    if (nodeCount > DEFER_DELETE_SUBTREE_NODE_THRESHOLD) {
      const backupRem: any = await plugin.rem.findOne(backupRemId);
      const hidden = await maybeHideBackupRem({ rem: backupRem });
      return {
        ok: true,
        parent_id: parentId,
        created_ids: createdIds,
        deleted_rem_ids: oldChildIds,
        ignored_backup_rem_ids: backupChildIds,
        backup_deleted: false,
        backup_rem_id: backupRemId,
        backup_policy: backupPolicy,
        backup_hidden: hidden,
        backup_cleanup_state: 'pending',
      };
    }
  }
  if (backupRemId) {
    try {
      const backupRem: any = await plugin.rem.findOne(backupRemId);
      if (backupRem) await backupRem.remove();
      backupDeleted = true;
      backupRemId = null;
    } catch {
      backupDeleted = false;
    }
  }

  if (!backupDeleted && backupRemId) {
    await rollbackCreated();
    let movedBack = false;
    try {
      await plugin.rem.moveRems(oldChildIds, parentId, 0);
      movedBack = true;
    } catch {}
    if (movedBack) {
      try {
        const stillInBackup: string[] = [];
        for (const id of oldChildIds) {
          try {
            const rem: any = await plugin.rem.findOne(id);
            if (rem && getParentIdOfRem(rem) === backupRemId) stillInBackup.push(id);
          } catch {}
        }
        if (stillInBackup.length === 0) {
          const backupRem: any = await plugin.rem.findOne(backupRemId);
          if (backupRem) await backupRem.remove();
          backupRemId = null;
        }
      } catch {}
    }
    return {
      ok: false,
      fatal: true,
      error: 'Failed to delete children replace backup; rolled back to original content',
      rolled_back: true,
      backup_rem_id: backupRemId,
      backup_policy: backupPolicy,
    };
  }

  return {
    ok: true,
    parent_id: parentId,
    created_ids: createdIds,
    deleted_rem_ids: oldChildIds,
    ignored_backup_rem_ids: backupChildIds,
    backup_deleted: backupDeleted,
    backup_rem_id: backupRemId,
    backup_policy: backupPolicy,
  };
}
