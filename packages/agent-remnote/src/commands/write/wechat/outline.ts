import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { CliError, isCliError } from '../../../services/Errors.js';
import { Payload } from '../../../services/Payload.js';
import { RefResolver } from '../../../services/RefResolver.js';
import { Subprocess } from '../../../services/Subprocess.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { enqueueOps, normalizeOp } from '../../_enqueue.js';
import { dropBlankLinesOutsideFences } from '../../../lib/text.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeUnicodeSpaces(text: string): string {
  return text
    .replace(/\u00A0/g, ' ')
    .replace(/\u2007/g, ' ')
    .replace(/\u202F/g, ' ')
    .replace(/\u3000/g, ' ')
    .replace(/\u200B/g, '')
    .replace(/\u200C/g, '')
    .replace(/\u200D/g, '')
    .replace(/\u2060/g, '');
}

function normalizeLine(line: string): string {
  const s = normalizeUnicodeSpaces(line);
  return s.replace(/[ \t]+/g, ' ').trim();
}

const NOISE_LINES = new Set([
  '长按识别二维码查看原文',
  '长按识别二维码阅读全文',
  '长按识别二维码查看',
  '点击阅读原文',
  '阅读原文',
]);

const SECTION_PREFIXES = new Set(['🔥', '📖', '🛠', '📢', '🎨', '🤖', '🧰', '📰', '📚', '🎬']);
const NOTE_PREFIXES = new Set(['💡', '📌', '📝']);

function isUrl(s: string): boolean {
  return /^https?:\/\//.test(s);
}

function isShortHeading(s: string): boolean {
  if (!s) return false;
  if (s.endsWith('：') || s.endsWith(':')) {
    const core = s.slice(0, -1).trim();
    return core.length >= 1 && core.length <= 8;
  }
  return false;
}

function isSectionHeading(s: string): boolean {
  if (!s) return false;
  if (isUrl(s)) return false;

  const first = s.slice(0, 2);
  for (const p of SECTION_PREFIXES) {
    if (first.startsWith(p)) return s.length <= 24;
  }

  const keywords = ['本周热点', '文章和视频', '代码和工具', '生态系统'];
  return keywords.some((k) => s.includes(k)) && s.length <= 24;
}

function isMetaLine(s: string): boolean {
  return s.startsWith('本期看点：') || s.startsWith('编辑：');
}

function isAuthorLike(s: string): boolean {
  if (!s || isUrl(s)) return false;
  const first = s.slice(0, 2);
  for (const p of SECTION_PREFIXES) {
    if (first.startsWith(p)) return false;
  }
  for (const p of NOTE_PREFIXES) {
    if (first.startsWith(p)) return false;
  }
  if (isShortHeading(s) || isSectionHeading(s) || isMetaLine(s)) return false;
  if (/\d/.test(s)) return false;
  if (s.length > 40) return false;
  if (/[。！？———：:]/.test(s)) return false;
  return /[A-Za-z\u4E00-\u9FFF]/.test(s);
}

function toBlocks(lines: readonly string[]): readonly string[] {
  const blocks: string[] = [];
  let buf: string[] = [];

  const flush = () => {
    if (buf.length > 0) {
      blocks.push(buf.join(' ').trim());
      buf = [];
    }
  };

  for (const raw of lines) {
    const s = normalizeLine(raw);
    if (!s) {
      flush();
      continue;
    }
    if (NOISE_LINES.has(s)) continue;
    buf.push(s);
  }
  flush();
  return blocks;
}

type Node = { text: string; children: Node[] };

function addChild(parent: Node, text: string): Node {
  const n: Node = { text, children: [] };
  parent.children.push(n);
  return n;
}

function clampAdd(parent: Node, text: string, parentDepth: number, maxDepth: number): Node {
  if (parentDepth + 1 > maxDepth) {
    parent.text = `${parent.text}; ${text}`;
    return parent;
  }
  return addChild(parent, text);
}

function renderMarkdown(root: Node, indent = '  '): string {
  const out: string[] = [];
  const emit = (node: Node, depth: number) => {
    out.push(`${indent.repeat(depth)}- ${node.text}`);
    for (const c of node.children) emit(c, depth + 1);
  };
  emit(root, 0);
  return out.join('\n').trimEnd() + '\n';
}

function outlineify(params: { title: string; url: string; content: string; maxDepth: number }): string {
  const blocks = toBlocks(params.content.split(/\r?\n/));
  const maxDepth = Math.max(2, params.maxDepth);

  const root: Node = { text: params.title, children: [] };
  if (params.url) {
    clampAdd(root, `Original: ${params.url}`, 1, maxDepth);
  }

  let currentSection: Node | null = null;
  let currentSectionDepth = 1;
  let currentSub: Node | null = null;
  let currentSubDepth = 2;
  let currentItem: Node | null = null;
  let currentItemDepth = 3;
  let lastWasUrl = false;

  const container = (): { parent: Node; depth: number } => {
    if (currentSub) return { parent: currentSub, depth: currentSubDepth };
    if (currentSection) return { parent: currentSection, depth: currentSectionDepth };
    return { parent: root, depth: 1 };
  };

  const attachToItemOrContainer = (text: string) => {
    let parent = container().parent;
    let depth = container().depth;
    if (currentItem) {
      parent = currentItem;
      depth = currentItemDepth;
    }
    clampAdd(parent, text, depth, maxDepth);
  };

  for (const b of blocks) {
    if (isMetaLine(b)) {
      clampAdd(root, b, 1, maxDepth);
      currentItem = null;
      lastWasUrl = false;
      continue;
    }

    if (isSectionHeading(b)) {
      currentSection = clampAdd(root, b, 1, maxDepth);
      currentSectionDepth = 2;
      currentSub = null;
      currentItem = null;
      lastWasUrl = false;
      continue;
    }

    if (isShortHeading(b)) {
      const name = b.slice(0, -1).trim();
      const parent = currentSection ?? root;
      const parentDepth = currentSection ? currentSectionDepth : 1;
      currentSub = clampAdd(parent, name, parentDepth, maxDepth);
      currentSubDepth = Math.min(parentDepth + 1, maxDepth);
      currentItem = null;
      lastWasUrl = false;
      continue;
    }

    if (isUrl(b)) {
      attachToItemOrContainer(b);
      lastWasUrl = true;
      continue;
    }

    if (lastWasUrl && currentItem && isAuthorLike(b)) {
      attachToItemOrContainer(`By: ${b}`);
      lastWasUrl = false;
      continue;
    }

    const first = b.slice(0, 2);
    if (currentItem && Array.from(NOTE_PREFIXES).some((p) => first.startsWith(p))) {
      clampAdd(currentItem, b, currentItemDepth, maxDepth);
      lastWasUrl = false;
      continue;
    }

    const { parent, depth } = container();
    currentItem = clampAdd(parent, b, depth, maxDepth);
    currentItemDepth = Math.min(depth + 1, maxDepth);
    lastWasUrl = false;
  }

  return renderMarkdown(root);
}

function agentBrowser(cdpPort: number, args: readonly string[], timeoutMs: number): Effect.Effect<void, CliError, Subprocess> {
  return Effect.gen(function* () {
    const subprocess = yield* Subprocess;
    const res = yield* subprocess.run({ command: 'agent-browser', args: ['--cdp', String(cdpPort), ...args], timeoutMs });
    if (res.exitCode === 0) return;
    return yield* Effect.fail(
      new CliError({
        code: 'AGENT_BROWSER_FAILED',
        message: 'agent-browser failed',
        exitCode: 1,
        details: { args, stderr: res.stderr.trim() },
      }),
    );
  });
}

function agentBrowserJson(cdpPort: number, args: readonly string[], timeoutMs: number): Effect.Effect<any, CliError, Subprocess> {
  return Effect.gen(function* () {
    const subprocess = yield* Subprocess;
    const res = yield* subprocess.run({
      command: 'agent-browser',
      args: ['--cdp', String(cdpPort), ...args, '--json'],
      timeoutMs,
    });
    if (res.exitCode !== 0) {
      return yield* Effect.fail(
        new CliError({
          code: 'AGENT_BROWSER_FAILED',
          message: 'agent-browser failed',
          exitCode: 1,
          details: { args, stderr: res.stderr.trim() },
        }),
      );
    }
    return yield* Effect.try({
      try: () => JSON.parse(res.stdout.trim()),
      catch: (e) =>
        new CliError({
          code: 'INTERNAL',
          message: 'agent-browser output is not valid JSON',
          exitCode: 1,
          details: { args, error: String((e as any)?.message || e) },
        }),
    });
  });
}

function mergeMeta(base: Record<string, unknown>, extra: unknown): Record<string, unknown> {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return base;
  return { ...base, ...(extra as Record<string, unknown>) };
}

const parent = Options.text('parent').pipe(Options.optional, Options.map(optionToUndefined));
const ref = Options.text('ref').pipe(Options.optional, Options.map(optionToUndefined));

const cdpPort = Options.integer('cdp-port').pipe(Options.optional, Options.map(optionToUndefined));
const maxDepth = Options.integer('max-depth').pipe(Options.optional, Options.map(optionToUndefined));
const waitMs = Options.integer('wait-ms').pipe(Options.optional, Options.map(optionToUndefined));
const titleSuffix = Options.text('title-suffix').pipe(Options.optional, Options.map(optionToUndefined));

const clientId = Options.text('client-id').pipe(Options.optional, Options.map(optionToUndefined));
const idempotencyKey = Options.text('idempotency-key').pipe(Options.optional, Options.map(optionToUndefined));
const priority = Options.integer('priority').pipe(Options.optional, Options.map(optionToUndefined));
const metaSpec = Options.text('meta').pipe(Options.optional, Options.map(optionToUndefined));
const notify = Options.boolean('no-notify').pipe(Options.map((v) => !v));
const ensureDaemon = Options.boolean('no-ensure-daemon').pipe(Options.map((v) => !v));

export const wechatOutlineCommand = Command.make(
  'outline',
  {
    url: Options.text('url'),
    parent,
    ref,
    cdpPort,
    maxDepth,
    waitMs,
    titleSuffix,
    notify,
    ensureDaemon,
    dryRun: Options.boolean('dry-run'),
    priority,
    clientId,
    idempotencyKey,
    meta: metaSpec,
  },
  ({
    url,
    parent,
    ref,
    cdpPort,
    maxDepth,
    waitMs,
    titleSuffix,
    notify,
    ensureDaemon,
    dryRun,
    priority,
    clientId,
    idempotencyKey,
    meta,
  }) =>
    Effect.gen(function* () {
      const payloadSvc = yield* Payload;
      const refs = yield* RefResolver;

      if (parent && ref) {
        return yield* Effect.fail(
          new CliError({ code: 'INVALID_ARGS', message: 'Choose only one of --parent or --ref', exitCode: 2 }),
        );
      }

      const resolvedParent = ref ? yield* refs.resolve(ref) : parent;
      if (!resolvedParent) {
        return yield* Effect.fail(
          new CliError({ code: 'INVALID_ARGS', message: 'You must provide --parent or --ref', exitCode: 2 }),
        );
      }

      const port = clampInt(cdpPort ?? 9001, 1, 65535);
      const depth = clampInt(maxDepth ?? 5, 2, 50);
      const wait = clampInt(waitMs ?? 5000, 0, 120_000);
      const suffix = titleSuffix !== undefined ? titleSuffix : ' (Structured Outline)';

      const list = yield* agentBrowserJson(port, ['tab', 'list'], 10_000);
      const origActiveRaw = (list as any)?.data?.active;
      const origActive =
        typeof origActiveRaw === 'number' ? origActiveRaw : Number.parseInt(String(origActiveRaw || '0'), 10) || 0;

      const created = yield* agentBrowserJson(port, ['tab', 'new'], 10_000);
      const newTabRaw = (created as any)?.data?.index;
      const newTab = typeof newTabRaw === 'number' ? newTabRaw : Number.parseInt(String(newTabRaw || ''), 10);
      if (!Number.isFinite(newTab)) {
        return yield* Effect.fail(
          new CliError({
            code: 'AGENT_BROWSER_FAILED',
            message: 'Failed to create new tab (no tab index returned)',
            exitCode: 1,
          }),
        );
      }

      const cleanup = agentBrowser(port, ['tab', String(origActive)], 10_000)
        .pipe(Effect.catchAll(() => Effect.void))
        .pipe(
          Effect.zipRight(
            agentBrowser(port, ['tab', 'close', String(newTab)], 10_000).pipe(Effect.catchAll(() => Effect.void)),
          ),
        );

      const extracted = yield* Effect.gen(function* () {
        yield* agentBrowser(port, ['tab', String(newTab)], 10_000);
        yield* agentBrowser(port, ['open', url], 30_000);
        if (wait > 0) yield* agentBrowser(port, ['wait', String(wait)], wait + 5_000);

        const js =
          "(() => { const title = (document.querySelector('#activity-name')?.innerText || document.querySelector('h1')?.innerText || document.title || '').trim(); const el = document.querySelector('#js_content'); const content = (el?.innerText || '').trim(); return { title, content }; })()";
        const res = yield* agentBrowserJson(port, ['eval', js], 30_000);
        return res;
      }).pipe(Effect.ensuring(cleanup));

      const rawTitle = String((extracted as any)?.data?.result?.title || '').trim();
      const rawContent = String((extracted as any)?.data?.result?.content || '').trim();
      if (!rawTitle || !rawContent) {
        return yield* Effect.fail(
          new CliError({
            code: 'EXTRACT_FAILED',
            message: 'Failed to extract title/content; ensure the page is loaded and contains #js_content',
            exitCode: 1,
          }),
        );
      }

      const title = suffix ? `${rawTitle}${suffix}` : rawTitle;
      const markdown = dropBlankLinesOutsideFences(outlineify({ title, url, content: rawContent, maxDepth: depth }));

      const baseMeta = {
        source: 'wechat',
        url,
        title,
        maxDepth: depth,
        bytes: Buffer.byteLength(rawContent, 'utf8'),
      };
      const extraMeta = meta ? yield* payloadSvc.readJson(meta) : undefined;
      const metaValue = mergeMeta(baseMeta, extraMeta);

      const op = yield* Effect.try({
        try: () =>
          normalizeOp(
            {
              type: 'create_tree_with_markdown',
              payload: { parentId: resolvedParent, markdown, parseMode: 'smart' },
            },
            payloadSvc.normalizeKeys,
          ),
        catch: (e) =>
          isCliError(e)
            ? e
            : new CliError({
                code: 'INVALID_PAYLOAD',
                message: 'Failed to generate op',
                exitCode: 2,
                details: { error: String((e as any)?.message || e) },
              }),
      });

      const resolvedClientId = clientId?.trim() || 'wechat-outline';

      if (dryRun) {
        yield* writeSuccess({
          data: { dry_run: true, ops: [op], meta: payloadSvc.normalizeKeys(metaValue) },
          md: [
            `- dry_run: true`,
            `- url: ${url}`,
            `- title: ${title}`,
            `- parent_id: ${resolvedParent}`,
            `- max_depth: ${depth}`,
          ].join('\n'),
        });
        return;
      }

      const data = yield* enqueueOps({
        ops: [op],
        priority,
        clientId: resolvedClientId,
        idempotencyKey,
        meta: metaValue,
        notify,
        ensureDaemon,
      });

      yield* writeSuccess({
        data,
        ids: [data.txn_id, ...data.op_ids],
        md: `- txn_id: ${data.txn_id}\n- op_ids: ${data.op_ids.length}\n- notified: ${data.notified}\n- sent: ${data.sent ?? ''}\n`,
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
