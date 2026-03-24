import { describe, expect, it } from 'vitest';

import { wave1RemnoteBusinessCommandContractIds } from '../helpers/remnoteBusinessCommandContracts.js';
import { startParityApiHarness } from '../helpers/remoteModeHarness.js';
import { runCli } from '../helpers/runCli.js';

type SmokeCase = {
  readonly commandId: (typeof wave1RemnoteBusinessCommandContractIds)[number];
  readonly args: readonly string[];
  readonly expectedEndpoints: readonly string[];
  readonly assertData?: (data: any) => void;
};

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

const writeEndpoints = ['/v1/write/apply', '/v1/queue/wait'] as const;

const smokeCases = [
  {
    commandId: 'search',
    args: ['search', '--query', 'hello'],
    expectedEndpoints: ['/v1/search/db'],
    assertData: (data) => expect(data.items[0]?.title).toBe('Hello'),
  },
  {
    commandId: 'rem.outline',
    args: ['rem', 'outline', '--id', 'RID-1', '--format', 'json'],
    expectedEndpoints: ['/v1/read/outline'],
    assertData: (data) => expect(data.rootId).toBe('RID-1'),
  },
  {
    commandId: 'daily.rem-id',
    args: ['daily', 'rem-id'],
    expectedEndpoints: ['/v1/daily/rem-id'],
    assertData: (data) => expect(data.remId).toBe('D1'),
  },
  {
    commandId: 'page-id',
    args: ['rem', 'page-id', '--ref', 'page:Inbox'],
    expectedEndpoints: ['/v1/read/page-id'],
    assertData: (data) => expect(data.results[0]?.pageId).toBe('PAGE-1'),
  },
  {
    commandId: 'by-reference',
    args: ['rem', 'by-reference', '--reference', 'RID-1', '--limit', '7'],
    expectedEndpoints: ['/v1/read/by-reference'],
    assertData: (data) => expect(data.items[0]?.title).toBe('Inbound Ref'),
  },
  {
    commandId: 'references',
    args: ['rem', 'references', '--id', 'RID-1', '--include-inbound'],
    expectedEndpoints: ['/v1/read/references'],
    assertData: (data) => expect(data.outbound[0]?.id).toBe('RID-2'),
  },
  {
    commandId: 'resolve-ref',
    args: ['rem', 'resolve-ref', '--ids', 'RID-1', '--detail'],
    expectedEndpoints: ['/v1/read/resolve-ref'],
    assertData: (data) => expect(data.results[0]?.references[0]?.id).toBe('RID-2'),
  },
  {
    commandId: 'query',
    args: ['query', '--text', 'hello', '--limit', '5'],
    expectedEndpoints: ['/v1/read/query'],
    assertData: (data) => expect(data.items[0]?.title).toBe('Query Match'),
  },
  {
    commandId: 'plugin.current',
    args: ['plugin', 'current', '--compact'],
    expectedEndpoints: ['/v1/plugin/current'],
    assertData: (data) => expect(data.current_id).toBe('SEL-1'),
  },
  {
    commandId: 'plugin.search',
    args: ['plugin', 'search', '--query', 'hello', '--limit', '5', '--timeout-ms', '2000', '--no-ensure-daemon'],
    expectedEndpoints: ['/v1/search/plugin'],
    assertData: (data) => expect(data.results[0]?.title).toBe('Plugin Search Match'),
  },
  {
    commandId: 'plugin.ui-context.snapshot',
    args: ['plugin', 'ui-context', 'snapshot'],
    expectedEndpoints: ['/v1/plugin/ui-context/snapshot'],
    assertData: (data) => expect(data.status).toBe('ok'),
  },
  {
    commandId: 'plugin.ui-context.page',
    args: ['plugin', 'ui-context', 'page'],
    expectedEndpoints: ['/v1/plugin/ui-context/page'],
    assertData: (data) => expect(data.page_rem_id).toBe('PAGE-1'),
  },
  {
    commandId: 'plugin.ui-context.focused-rem',
    args: ['plugin', 'ui-context', 'focused-rem'],
    expectedEndpoints: ['/v1/plugin/ui-context/focused-rem'],
    assertData: (data) => expect(data.focused_rem_id).toBe('FOCUS-1'),
  },
  {
    commandId: 'plugin.ui-context.describe',
    args: ['plugin', 'ui-context', 'describe', '--selection-limit', '5'],
    expectedEndpoints: ['/v1/plugin/ui-context/describe'],
    assertData: (data) => expect(data.focus.id).toBe('FOCUS-1'),
  },
  {
    commandId: 'plugin.selection.current',
    args: ['plugin', 'selection', 'current', '--compact'],
    expectedEndpoints: ['/v1/plugin/selection/current'],
    assertData: (data) => expect(data.current_id).toBe('SEL-1'),
  },
  {
    commandId: 'plugin.selection.snapshot',
    args: ['plugin', 'selection', 'snapshot'],
    expectedEndpoints: ['/v1/plugin/selection/snapshot'],
    assertData: (data) => expect(data.selection.remIds).toEqual(['SEL-1']),
  },
  {
    commandId: 'plugin.selection.roots',
    args: ['plugin', 'selection', 'roots'],
    expectedEndpoints: ['/v1/plugin/selection/roots'],
    assertData: (data) => expect(data.ids).toEqual(['SEL-1']),
  },
  {
    commandId: 'plugin.selection.outline',
    args: ['plugin', 'selection', 'outline', '--max-depth', '3', '--max-nodes', '100'],
    expectedEndpoints: ['/v1/plugin/selection/outline'],
    assertData: (data) => expect(data.roots[0]?.rootId).toBe('SEL-1'),
  },
  {
    commandId: 'daily.write',
    args: ['daily', 'write', '--text', 'hello', '--wait'],
    expectedEndpoints: writeEndpoints,
    assertData: (data) => expect(data.txn_id).toBe('txn-1'),
  },
  {
    commandId: 'apply',
    args: [
      'apply',
      '--payload',
      JSON.stringify({
        version: 1,
        kind: 'actions',
        actions: [{ action: 'write.bullet', input: { parent_id: 'PARENT-1', text: 'hello' } }],
      }),
      '--wait',
    ],
    expectedEndpoints: writeEndpoints,
    assertData: (data) => expect(data.txn_id).toBe('txn-1'),
  },
  {
    commandId: 'queue.wait',
    args: ['queue', 'wait', '--txn', 'txn-1'],
    expectedEndpoints: ['/v1/queue/wait'],
    assertData: (data) => expect(data.txn_id).toBe('txn-1'),
  },
  {
    commandId: 'rem.create',
    args: ['rem', 'create', '--text', 'hello', '--at', 'parent:id:PARENT-1', '--wait'],
    expectedEndpoints: writeEndpoints,
    assertData: (data) => expect(data.txn_id).toBe('txn-1'),
  },
  {
    commandId: 'rem.move',
    args: ['rem', 'move', '--subject', 'id:r1', '--at', 'parent:id:PARENT-1', '--wait'],
    expectedEndpoints: writeEndpoints,
    assertData: (data) => expect(data.txn_id).toBe('txn-1'),
  },
  {
    commandId: 'portal.create',
    args: ['portal', 'create', '--to', 'id:t1', '--at', 'parent:id:PARENT-1', '--wait'],
    expectedEndpoints: writeEndpoints,
    assertData: (data) => expect(data.txn_id).toBe('txn-1'),
  },
  {
    commandId: 'rem.replace',
    args: ['rem', 'replace', '--subject', 'id:r1', '--surface', 'children', '--markdown', '- child', '--wait'],
    expectedEndpoints: writeEndpoints,
    assertData: (data) => expect(data.txn_id).toBe('txn-1'),
  },
  {
    commandId: 'rem.children.append',
    args: ['rem', 'children', 'append', '--subject', 'id:r1', '--markdown', '- child', '--wait'],
    expectedEndpoints: writeEndpoints,
    assertData: (data) => expect(data.txn_id).toBe('txn-1'),
  },
  {
    commandId: 'rem.children.prepend',
    args: ['rem', 'children', 'prepend', '--subject', 'id:r1', '--markdown', '- child', '--wait'],
    expectedEndpoints: writeEndpoints,
    assertData: (data) => expect(data.txn_id).toBe('txn-1'),
  },
  {
    commandId: 'rem.children.clear',
    args: ['rem', 'children', 'clear', '--subject', 'id:r1', '--wait'],
    expectedEndpoints: writeEndpoints,
    assertData: (data) => expect(data.txn_id).toBe('txn-1'),
  },
  {
    commandId: 'rem.children.replace',
    args: ['rem', 'children', 'replace', '--subject', 'id:r1', '--markdown', '- child', '--wait'],
    expectedEndpoints: writeEndpoints,
    assertData: (data) => expect(data.txn_id).toBe('txn-1'),
  },
  {
    commandId: 'rem.set-text',
    args: ['rem', 'set-text', '--subject', 'id:r1', '--text', 'hello', '--wait'],
    expectedEndpoints: writeEndpoints,
    assertData: (data) => expect(data.txn_id).toBe('txn-1'),
  },
  {
    commandId: 'rem.delete',
    args: ['rem', 'delete', '--subject', 'id:r1', '--wait'],
    expectedEndpoints: writeEndpoints,
    assertData: (data) => expect(data.txn_id).toBe('txn-1'),
  },
  {
    commandId: 'tag.add',
    args: ['tag', 'add', '--tag', 'id:t1', '--to', 'id:r1', '--wait'],
    expectedEndpoints: writeEndpoints,
    assertData: (data) => expect(data.txn_id).toBe('txn-1'),
  },
  {
    commandId: 'tag.remove',
    args: ['tag', 'remove', '--tag', 'id:t1', '--to', 'id:r1', '--wait'],
    expectedEndpoints: writeEndpoints,
    assertData: (data) => expect(data.txn_id).toBe('txn-1'),
  },
  {
    commandId: 'rem.tag.add',
    args: ['rem', 'tag', 'add', '--tag', 'id:t1', '--to', 'id:r1', '--wait'],
    expectedEndpoints: writeEndpoints,
    assertData: (data) => expect(data.txn_id).toBe('txn-1'),
  },
  {
    commandId: 'rem.tag.remove',
    args: ['rem', 'tag', 'remove', '--tag', 'id:t1', '--to', 'id:r1', '--wait'],
    expectedEndpoints: writeEndpoints,
    assertData: (data) => expect(data.txn_id).toBe('txn-1'),
  },
] as const satisfies readonly SmokeCase[];

describe('contract: wave1 remote mode smoke', () => {
  it('keeps one representative remote smoke case for every wave1 business command', () => {
    const ids = smokeCases.map((item) => item.commandId).sort();
    expect(ids).toEqual([...wave1RemnoteBusinessCommandContractIds].sort());
  });

  it.each(smokeCases)('$commandId routes through host api and returns success for its representative case', async (item) => {
    const api = await startParityApiHarness('/v1');
    try {
      const res = await runCli(['--json', '--api-base-url', api.baseUrl, ...item.args], {
        timeoutMs: 20_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      item.assertData?.(parsed.data);

      const urls = api.requests.map((request) => String(request.url ?? ''));
      for (const endpoint of item.expectedEndpoints) {
        expect(urls.some((url) => url === endpoint || url.startsWith(`${endpoint}?`))).toBe(true);
      }
    } finally {
      await api.close();
    }
  });
});
