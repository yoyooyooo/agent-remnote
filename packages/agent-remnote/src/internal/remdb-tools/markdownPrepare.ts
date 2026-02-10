import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';

export type PreparedBlocks = {
  preface?: string;
  items: Array<{ heading: string; body: string }>;
};

export async function prepareMarkdownForCreateTree(markdown: string): Promise<PreparedBlocks> {
  const u = unified().use(remarkParse).use(remarkGfm);
  const tree: any = u.parse(markdown);
  tree.children = liftListHeadings(tree.children);

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
  md = normalizeUnicodeSpaces(md);
  md = normalizeListIndentation(md);
  md = removeBlankLines(md);
  md = maybeUnlistSingleItem(md);
  return md;
}

function normalizeUnicodeSpaces(text: string): string {
  return text
    .replace(/[\u00A0\u2007\u202F\u2002-\u2006\u2008-\u200A\u3000]/g, ' ')
    .replace(/[\u200B\u200C\u200D\u2060]/g, '');
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
    if (/^\s{1,3}[-*+]\s+/.test(line)) {
      lines[i] = line.replace(/^\s{1,3}([-*+])\s+/, '$1 ');
      continue;
    }
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
      if (line.trim().length === 0) continue;
      out.push(line);
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
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
