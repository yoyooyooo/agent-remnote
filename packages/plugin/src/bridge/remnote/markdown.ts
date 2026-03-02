import type { ReactRNPlugin } from '@remnote/plugin-sdk';

import { sleep } from '../shared/sleep';

import { attachNewRem } from './attachNewRem';
import { toRichText } from './richText';

// Markdown AST import (remark): split into heading blocks.
// - Headings are created with `createSingleRemWithMarkdown`.
// - Body chunks are created with `createTreeWithMarkdown`.
export async function parseMarkdownBlocks(
  markdown: string,
): Promise<{ preface?: string; items: Array<{ heading: string; body: string }> }> {
  const { unified } = await import('unified');
  const { default: remarkParse } = (await import('remark-parse')) as any;
  const { default: remarkGfm } = (await import('remark-gfm')) as any;
  const { default: remarkStringify } = (await import('remark-stringify')) as any;
  const u = unified().use(remarkParse).use(remarkGfm);
  const tree: any = u.parse(markdown);
  // Lift headings that appear inside list items.
  tree.children = liftListHeadings(tree.children);
  // Split: heading => collect nodes until the next heading as body.
  const items: Array<{ heading: string; body: string }> = [];
  const bodyNodes: any[] = [];
  let prefaceNodes: any[] = [];
  for (const node of tree.children) {
    if (node.type === 'heading') {
      if (bodyNodes.length > 0 && items.length > 0) {
        const bodyMd = unified()
          .use(remarkStringify)
          .stringify({ type: 'root', children: bodyNodes } as any) as string;
        items[items.length - 1].body = normalizeBody(bodyMd);
        bodyNodes.length = 0;
      }
      // Keep inline markdown in heading and let RemNote handle it.
      const titleMd = unified()
        .use(remarkStringify)
        .stringify({ type: 'root', children: [node] } as any) as string;
      items.push({ heading: titleMd.trim(), body: '' });
    } else {
      if (items.length === 0) prefaceNodes.push(node);
      else bodyNodes.push(node);
    }
  }
  if (bodyNodes.length > 0 && items.length > 0) {
    const bodyMd = unified()
      .use(remarkStringify)
      .stringify({ type: 'root', children: bodyNodes } as any) as string;
    items[items.length - 1].body = normalizeBody(bodyMd);
  }
  const preface =
    prefaceNodes.length > 0
      ? normalizeBody(
          unified()
            .use(remarkStringify)
            .stringify({ type: 'root', children: prefaceNodes } as any) as string,
        )
      : undefined;
  return { preface, items };
}

function liftListHeadings(children: any[]): any[] {
  const out: any[] = [];
  for (const node of children) {
    if (node.type === 'list' && Array.isArray(node.children)) {
      for (const li of node.children) {
        if (!li || !Array.isArray(li.children) || li.children.length === 0) continue;
        // If the first child of the listItem is a heading, lift it to top-level,
        // and then lift the remaining nodes as normal siblings.
        const first = li.children[0];
        if (first && first.type === 'heading') {
          out.push(first);
          const rest = li.children.slice(1);
          if (rest.length > 0) out.push(...rest);
        } else {
          out.push(li);
        }
      }
    } else {
      out.push(node);
    }
  }
  return out;
}

function normalizeBody(md: string): string {
  // Clean unicode spaces, remove blank lines (except inside code fences),
  // and normalize top-level list indentation.
  md = normalizeUnicodeSpaces(md);
  md = normalizeListIndentation(md);
  md = removeBlankLines(md);
  // If the body is a single list item, degrade to a paragraph to avoid dangling "- ".
  md = maybeUnlistSingleItem(md);
  return md;
}

type IdRefPlaceholder = { placeholder: string; remId: string; original: string };

const REM_ID_PATTERN = /^[A-Za-z0-9]{17}$/;
const ID_REF_PATTERN = /\(\(([^\s()|]+)(?:\|[^()]+)?\)\)|\{ref:([A-Za-z0-9]+)\}/g;

export function replaceIdReferencesWithPlaceholders(input: string): { markdown: string; refs: IdRefPlaceholder[] } {
  const mayContainParenRef = input.includes('((') && input.includes('))');
  const mayContainBraceRef = input.includes('{ref:') && input.includes('}');
  if (!mayContainParenRef && !mayContainBraceRef) return { markdown: input, refs: [] };
  const refs: IdRefPlaceholder[] = [];
  const markdown = input.replace(ID_REF_PATTERN, (full, remIdRawParen, remIdRawBrace) => {
    const remIdRaw = typeof remIdRawParen === 'string' && remIdRawParen.trim() ? remIdRawParen : remIdRawBrace;
    const remId = typeof remIdRaw === 'string' ? remIdRaw.trim() : '';
    if (!REM_ID_PATTERN.test(remId)) return full;
    const placeholder = `AGENT_REMNOTE_REF_PLACEHOLDER_${refs.length}`;
    refs.push({ placeholder, remId, original: full });
    return placeholder;
  });
  return { markdown, refs };
}

async function computeExistingRemIds(
  plugin: ReactRNPlugin,
  refs: readonly IdRefPlaceholder[],
): Promise<Map<string, boolean>> {
  const exists = new Map<string, boolean>();
  for (const r of refs) {
    if (exists.has(r.remId)) continue;
    try {
      exists.set(r.remId, Boolean(await plugin.rem.findOne(r.remId)));
    } catch {
      exists.set(r.remId, false);
    }
  }
  return exists;
}

type PatchMode = 'resolve' | 'plain';

function patchRichTextPlaceholders(
  rt: unknown,
  refs: readonly IdRefPlaceholder[],
  exists: ReadonlyMap<string, boolean>,
  mode: PatchMode,
): { richText: unknown; changed: boolean } {
  if (!Array.isArray(rt) || refs.length === 0) return { richText: rt, changed: false };

  const patchText = (text: string, token?: any): { items: any[]; changed: boolean } => {
    let cursor = 0;
    let changed = false;
    const out: any[] = [];

    const pushText = (t: string) => {
      if (!t) return;
      if (token && typeof token === 'object') out.push({ ...token, text: t });
      else out.push(t);
    };

    while (cursor < text.length) {
      let nextIndex = -1;
      let nextRef: IdRefPlaceholder | undefined;
      for (const r of refs) {
        const idx = text.indexOf(r.placeholder, cursor);
        if (idx >= 0 && (nextIndex < 0 || idx < nextIndex)) {
          nextIndex = idx;
          nextRef = r;
        }
      }
      if (nextIndex < 0 || !nextRef) break;

      const before = text.slice(cursor, nextIndex);
      pushText(before);

      const shouldResolve = mode === 'resolve' && exists.get(nextRef.remId) === true;
      if (shouldResolve) out.push({ i: 'q', _id: nextRef.remId });
      else pushText(nextRef.original);

      cursor = nextIndex + nextRef.placeholder.length;
      changed = true;
    }

    const tail = text.slice(cursor);
    pushText(tail);

    if (!changed) return { items: token ? [token] : [text], changed: false };
    if (out.length === 0) return { items: token ? [token] : [text], changed: false };
    return { items: out, changed: true };
  };

  const patchNode = (node: any): { items: any[]; changed: boolean } => {
    if (typeof node === 'string') return patchText(node);

    if (node && typeof node === 'object') {
      if (node.i === 'm' && typeof node.text === 'string') return patchText(node.text, node);

      const children = (node as any).children;
      if (Array.isArray(children)) {
        const patched = patchRichTextPlaceholders(children, refs, exists, mode);
        if (!patched.changed) return { items: [node], changed: false };
        return { items: [{ ...node, children: patched.richText }], changed: true };
      }
    }

    return { items: [node], changed: false };
  };

  let changedAny = false;
  const out: any[] = [];
  for (const node of rt) {
    const res = patchNode(node);
    if (res.changed) changedAny = true;
    out.push(...res.items);
  }
  return changedAny ? { richText: out, changed: true } : { richText: rt, changed: false };
}

function shouldParseInlineMarkdownFromPlainRichText(rt: unknown): rt is string[] {
  if (!Array.isArray(rt) || rt.length === 0) return false;
  if (!rt.every((x) => typeof x === 'string')) return false;
  const text = rt.join('');
  if (!text.trim()) return false;
  // Common cases where users expect Markdown -> RichText conversion but native tree import may keep raw text.
  if (/\[[^\]]+\]\([^)]+\)/.test(text)) return true; // link: [title](url)
  if (text.includes('**')) return true; // bold
  if (text.includes('`')) return true; // inline code
  if (text.includes('~~')) return true; // strikethrough
  return false;
}

export async function createSingleRemWithMarkdownAndFixRefs(
  plugin: ReactRNPlugin,
  markdown: string,
  parentId: string,
): Promise<any | undefined> {
  const { markdown: patchedMd, refs } = replaceIdReferencesWithPlaceholders(markdown);
  const rem = await plugin.rem.createSingleRemWithMarkdown(patchedMd, parentId);
  if (!rem) return undefined;
  if (refs.length === 0) return rem;

  const exists = await computeExistingRemIds(plugin, refs);
  const resolved = patchRichTextPlaceholders((rem as any).text, refs, exists, 'resolve');
  if (!resolved.changed) return rem;

  try {
    // @ts-ignore
    await rem.setText(resolved.richText);
  } catch {
    const plain = patchRichTextPlaceholders((rem as any).text, refs, exists, 'plain');
    try {
      // @ts-ignore
      await rem.setText(plain.richText);
    } catch {}
  }
  return rem;
}

export async function createTreeWithMarkdownAndFixRefs(
  plugin: ReactRNPlugin,
  markdown: string,
  parentId: string,
): Promise<any[]> {
  const { markdown: patchedMd, refs } = replaceIdReferencesWithPlaceholders(markdown);
  const rems = await plugin.rem.createTreeWithMarkdown(patchedMd, parentId);
  if (!Array.isArray(rems) || rems.length === 0) return rems;
  const exists = refs.length > 0 ? await computeExistingRemIds(plugin, refs) : null;
  for (const rem of rems) {
    if (!rem) continue;
    const originalText = (rem as any).text;

    let baseRichText: unknown = originalText;
    let parsed = false;
    if (shouldParseInlineMarkdownFromPlainRichText(originalText)) {
      try {
        baseRichText = await plugin.richText.parseFromMarkdown(originalText.join(''));
        parsed = true;
      } catch {}
    }

    let changed = parsed;
    let resolvedRichText: unknown = baseRichText;
    if (exists) {
      const resolved = patchRichTextPlaceholders(baseRichText, refs, exists, 'resolve');
      if (resolved.changed) {
        resolvedRichText = resolved.richText;
        changed = true;
      }
    }

    if (!changed) continue;

    try {
      // @ts-ignore
      await rem.setText(resolvedRichText);
    } catch {
      if (!exists) continue;
      const plain = patchRichTextPlaceholders(baseRichText, refs, exists, 'plain');
      if (!plain.changed && !parsed) continue;
      try {
        // @ts-ignore
        await rem.setText(plain.richText);
      } catch {}
    }
  }
  return rems;
}

// Legacy indent-based importer (kept as fallback).
export async function importMarkdownByIndent(
  plugin: ReactRNPlugin,
  markdown: string,
  parentId?: string | null,
  indentSize = 2,
): Promise<any[]> {
  const created: any[] = [];
  const baseStack: Array<{ level: number; id: string | null }> = [{ level: -1, id: parentId ?? null }];
  const lines = markdown.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n');

  const hasIndent = lines.some((ln) => (ln.match(/^\s*/)?.[0] ?? '').length >= indentSize);
  const hasHeading = lines.some((ln) => /^(?:\s*[-*+]\s+)?\s*#{1,6}\s+/.test(ln));

  let i = 0;
  const createPlainTextRem = async (text: string, parent: string | null) => {
    const parentId = typeof parent === 'string' ? parent.trim() : '';
    if (!parentId) return null;
    const rem = await plugin.rem.createRem();
    if (!rem) return null;
    await attachNewRem(plugin, rem, parentId, 999999);
    try {
      // @ts-ignore
      await rem.setText(toRichText(text));
    } catch {}
    return rem;
  };

  const createRichTextRem = async (input: any, parent: string | null) => {
    const parentId = typeof parent === 'string' ? parent.trim() : '';
    if (!parentId) return null;
    const rem = await plugin.rem.createRem();
    if (!rem) return null;
    await attachNewRem(plugin, rem, parentId, 999999);
    try {
      // @ts-ignore
      await rem.setText(toRichText(input));
    } catch {}
    return rem;
  };

  const parseTodoLine = (text: string): { status: 'Finished' | 'Unfinished'; body: string } | null => {
    const m = text.match(/^\[([ xX])\]\s+(.*)$/);
    if (!m) return null;
    const mark = (m[1] ?? ' ').toLowerCase();
    const body = String(m[2] ?? '').trim();
    if (!body) return null;
    return { status: mark === 'x' ? 'Finished' : 'Unfinished', body };
  };

  const createCodeBlockRem = async (codeText: string, language: string, parent: string | null) => {
    const token: any = { i: 'm', code: true, text: codeText };
    const lang = language.trim();
    if (lang) token.language = lang;
    const rem = await createRichTextRem([token], parent);
    if (rem) {
      try {
        // @ts-ignore
        if (typeof (rem as any).setIsCode === 'function') await (rem as any).setIsCode(true);
      } catch {}
    }
    return rem;
  };

  // Helper: create a Rem with Markdown (inline rich-text) when possible,
  // and fall back to plain text (keeps legacy behavior if markdown parsing fails).
  const createMarkdownRem = async (markdownText: string, fallbackPlainText: string, parent: string | null) => {
    const parentId = typeof parent === 'string' ? parent.trim() : '';
    if (!parentId) return null;
    try {
      const rem = await createSingleRemWithMarkdownAndFixRefs(plugin, markdownText, parentId);
      if (rem) return rem;
    } catch {}
    return await createPlainTextRem(fallbackPlainText, parentId);
  };

  const handleIndentMode = async () => {
    const stack = baseStack.slice();
    while (i < lines.length) {
      let line = lines[i];
      if (!line || /^\s*$/.test(line)) {
        i += 1;
        continue;
      }
      // Code fence: import as a single plain Rem.
      const fenceStart = line.match(/^(\s*)```(.*)$/);
      if (fenceStart) {
        const leading = fenceStart[1] ?? '';
        const startSpaces = leading.length;
        const level = Math.max(0, Math.floor(startSpaces / Math.max(1, indentSize)));
        const body: string[] = [];
        const fenceInfo = String(fenceStart[2] ?? '').trimEnd();
        i += 1;
        while (i < lines.length) {
          const end = lines[i];
          if (/^\s*```\s*$/.test(end)) {
            i += 1;
            break;
          }
          body.push(end);
          i += 1;
        }
        const codeBlock = body.join('\n');
        const parent = findParentId(stack, level);
        const rem = await createCodeBlockRem(codeBlock, fenceInfo, parent);
        if (rem) {
          created.push(rem);
          pushStack(stack, level, rem._id);
        }
        continue;
      }

      const leadingSpaces = (line.match(/^\s*/)?.[0] ?? '').length;
      let level = Math.max(0, Math.floor(leadingSpaces / Math.max(1, indentSize)));
      let text = line.slice(leadingSpaces);
      let markdownText = text;
      let todoStatus: 'Finished' | 'Unfinished' | null = null;
      // Strip optional list prefix.
      const listMatch = text.match(/^([*+-])\s+(.*)$/);
      if (listMatch) {
        text = listMatch[2];
        const todo = parseTodoLine(text);
        if (todo) {
          todoStatus = todo.status;
          text = todo.body;
          markdownText = todo.body;
        } else {
          markdownText = text;
        }
        const top = stack[stack.length - 1];
        if (level === 0 && top && top.level >= 0 && top.id) {
          level = top.level + 1;
        }
      } else {
        const orderedMatch = text.match(/^(\d+\.)\s+(.*)$/);
        if (orderedMatch) {
          text = orderedMatch[2];
          markdownText = text;
          const top = stack[stack.length - 1];
          if (level === 0 && top && top.level >= 0 && top.id) {
            level = top.level + 1;
          }
        }
      }
      const parent = findParentId(stack, level);
      const rem = await createMarkdownRem(markdownText, text, parent);
      if (rem) {
        if (todoStatus) {
          try {
            // @ts-ignore
            if (typeof (rem as any).setIsTodo === 'function') await (rem as any).setIsTodo(true);
          } catch {}
          try {
            // @ts-ignore
            if (typeof (rem as any).setTodoStatus === 'function') await (rem as any).setTodoStatus(todoStatus);
          } catch {}
        }
        created.push(rem);
        pushStack(stack, level, rem._id);
      }
      i += 1;
      if (created.length % 20 === 0) {
        await sleep(15);
      }
    }
  };

  // Heading mode:
  // - h1-h6 forms the hierarchy.
  // - Non-heading lines are accumulated and created under the latest heading.
  const handleHeadingMode = async () => {
    const parentBase = findParentId(baseStack, 0);
    let currentHeadingId: string | null = null;
    let section: string[] = [];

    const flushSection = async () => {
      // Flush accumulated lines into the current heading, or parentBase if no heading yet.
      const raw = section.join('\n');
      section = [];
      let chunk = raw.replace(/\r\n?/g, '\n');
      // Trim leading/trailing blank lines to avoid empty Rems.
      chunk = chunk.replace(/^\s*\n+/g, '').replace(/\n+\s*$/g, '');
      if (!chunk.trim()) return;
      chunk = normalizeUnicodeSpaces(chunk);
      chunk = normalizeListIndentation(chunk);
      chunk = removeBlankLines(chunk);
      chunk = maybeUnlistSingleItem(chunk);
      const target = currentHeadingId ?? parentBase;
      if (!target) return;
      try {
        await createTreeWithMarkdownAndFixRefs(plugin, chunk, target);
      } catch {}
      await sleep(10);
    };

    const createHeading = async (headline: string) => {
      await flushSection();
      const parentId = parentBase ?? '';
      if (!parentId) return;
      const rem = await createSingleRemWithMarkdownAndFixRefs(plugin, headline.trim(), parentId);
      if (rem) {
        created.push(rem);
        currentHeadingId = rem._id;
      }
    };

    let inFence = false;
    while (i < lines.length) {
      const lineRaw = lines[i];
      const line = lineRaw ?? '';
      i += 1;

      if (line.trim().length === 0) {
        section.push(line);
        continue;
      }

      // Code fences: keep them as-is and let RemNote parse.
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        section.push(line);
        continue;
      }
      if (inFence) {
        section.push(line);
        continue;
      }

      const head = line.match(/^\s*(?:[-*+]\s+)?(#{1,6})\s+(.*)$/);
      if (head) {
        await flushSection();
        const hMarks = head[1];
        const titleTxt = head[2];
        await createHeading(`${hMarks} ${titleTxt}`);
        continue;
      }

      section.push(line);
    }
    await flushSection();
  };

  if (hasHeading) {
    await handleHeadingMode();
  } else if (hasIndent) {
    await handleIndentMode();
  } else {
    // Simple line-by-line import.
    while (i < lines.length) {
      const line = lines[i];
      i += 1;
      if (!line || /^\s*$/.test(line)) continue;
      let text = line.trimEnd();
      const m = text.match(/^([*+-])\s+(.*)$/);
      let markdownText = text;
      if (m) {
        text = m[2];
        const todo = parseTodoLine(text);
        if (todo) {
          markdownText = todo.body;
          text = todo.body;
          const rem = await createMarkdownRem(markdownText.replace(/^\s+/, ''), text.replace(/^\s+/, ''), parentId ?? null);
          if (rem) {
            try {
              // @ts-ignore
              if (typeof (rem as any).setIsTodo === 'function') await (rem as any).setIsTodo(true);
            } catch {}
            try {
              // @ts-ignore
              if (typeof (rem as any).setTodoStatus === 'function') await (rem as any).setTodoStatus(todo.status);
            } catch {}
            created.push(rem);
          }
          if (created.length % 20 === 0) {
            await sleep(15);
          }
          continue;
        }
        markdownText = text;
      } else {
        const orderedMatch = text.match(/^(\d+\.)\s+(.*)$/);
        if (orderedMatch) {
          text = orderedMatch[2];
          markdownText = text;
        }
      }
      const rem = await createMarkdownRem(markdownText.replace(/^\s+/, ''), text.replace(/^\s+/, ''), parentId ?? null);
      if (rem) created.push(rem);
      if (created.length % 20 === 0) {
        await sleep(15);
      }
    }
  }
  return created;
}

function findParentId(stack: Array<{ level: number; id: string | null }>, level: number): string | null {
  while (stack.length > 0 && stack[stack.length - 1].level >= level) {
    stack.pop();
  }
  return stack.length > 0 ? stack[stack.length - 1].id : null;
}

function pushStack(stack: Array<{ level: number; id: string | null }>, level: number, id: string) {
  stack.push({ level, id });
}

function normalizeListIndentation(text: string): string {
  const lines = text.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // Top-level unordered list: 1-3 leading spaces => align to column 0.
    if (/^\s{1,3}[-*+]\s+/.test(line)) {
      lines[i] = line.replace(/^\s{1,3}([-*+])\s+/, '$1 ');
      continue;
    }
    // Top-level ordered list: 1-3 leading spaces => align to column 0.
    if (/^\s{1,3}\d+\.\s+/.test(line)) {
      lines[i] = line.replace(/^\s{1,3}(\d+\.)\s+/, '$1 ');
      continue;
    }
  }
  return lines.join('\n');
}

function removeBlankLines(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (!inFence) {
      const isBlank = line.trim().length === 0;
      if (isBlank) {
        continue;
      }
      out.push(line);
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

function normalizeUnicodeSpaces(text: string): string {
  return text
    .replace(/[\u00A0\u2007\u202F\u2002-\u2006\u2008-\u200A\u3000]/g, ' ')
    .replace(/[\u200B\u200C\u200D\u2060]/g, '');
}

function maybeUnlistSingleItem(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length !== 1) return text;
  const m1 = lines[0].match(/^\s*[-*+]\s+(.*)$/);
  const m2 = lines[0].match(/^\s*\d+\.\s+(.*)$/);
  if (m1) return m1[1];
  if (m2) return m2[1];
  return text;
}
