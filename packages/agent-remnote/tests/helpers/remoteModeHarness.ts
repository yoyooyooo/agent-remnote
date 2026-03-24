import { startJsonApiStub, type HttpApiStubRequest, type HttpApiStubResponse } from './httpApiStub.js';

export async function startParityApiHarness(basePath: string) {
  return await startJsonApiStub((request: HttpApiStubRequest): HttpApiStubResponse | undefined => {
    const withBase = (suffix: string) => `${basePath}${suffix}`;

    if (request.method === 'POST' && request.url === withBase('/read/outline')) {
      return {
        payload: {
          ok: true,
          data: {
            rootId: 'RID-1',
            title: 'Outline Root',
            markdown: '- Outline Root',
            tree: [{ id: 'RID-1', depth: 0, kind: 'rem', text: 'Outline Root' }],
          },
        },
      };
    }

    if (request.method === 'POST' && request.url === withBase('/read/page-id')) {
      return {
        payload: {
          ok: true,
          data: {
            results: [{ input: request.body?.ref ?? 'page:Inbox', found: true, pageId: 'PAGE-1' }],
          },
        },
      };
    }

    if (request.method === 'POST' && request.url === withBase('/read/resolve-ref')) {
      return {
        payload: {
          ok: true,
          data: {
            results: [{ remId: 'RID-1', references: [{ id: 'RID-2', text: 'Target' }] }],
          },
        },
      };
    }

    if (request.method === 'POST' && request.url === withBase('/read/by-reference')) {
      return {
        payload: {
          ok: true,
          data: {
            total: 1,
            items: [{ remId: 'RID-2', title: 'Inbound Ref' }],
          },
        },
      };
    }

    if (request.method === 'POST' && request.url === withBase('/read/references')) {
      return {
        payload: {
          ok: true,
          data: {
            id: 'RID-1',
            outbound: [{ id: 'RID-2', text: 'Target' }],
            inbound: [{ id: 'RID-3', text: 'Source' }],
          },
        },
      };
    }

    if (request.method === 'POST' && request.url === withBase('/read/query')) {
      return {
        payload: {
          ok: true,
          data: {
            totalMatched: 1,
            items: [{ id: 'RID-3', title: 'Query Match', snippet: 'hello world' }],
          },
        },
      };
    }

    if (request.method === 'POST' && request.url === withBase('/search/db')) {
      return {
        payload: {
          ok: true,
          data: {
            query: request.body?.query ?? '',
            total: 1,
            items: [{ id: 'RID-1', title: 'Hello' }],
            markdown: '- Hello',
          },
        },
      };
    }

    if (request.method === 'POST' && request.url === withBase('/search/plugin')) {
      return {
        payload: {
          ok: true,
          data: {
            ok: true,
            results: [{ remId: 'RID-9', title: 'Plugin Search Match', snippet: 'plugin hello world' }],
          },
        },
      };
    }

    if (request.method === 'GET' && request.url?.startsWith(withBase('/daily/rem-id'))) {
      return {
        payload: {
          ok: true,
          data: {
            ref: 'daily:today',
            remId: 'D1',
            dateString: '2026/03/11',
          },
        },
      };
    }

    if (request.method === 'GET' && request.url?.startsWith(withBase('/plugin/ui-context/snapshot'))) {
      return {
        payload: {
          ok: true,
          data: {
            status: 'ok',
            state_file: '/tmp/ws.state.json',
            updatedAt: 1,
            now: 2,
            stale_ms: 60_000,
            clients: 1,
            ui_context: {
              kbId: 'KB-1',
              kbName: 'KB Name',
              url: '/kb/KB-1/page/PAGE-1',
              paneId: 'pane-1',
              pageRemId: 'PAGE-1',
              focusedRemId: 'FOCUS-1',
              focusedPortalId: 'PAGE-1',
              source: 'connect',
              updatedAt: 1,
            },
          },
        },
      };
    }

    if (request.method === 'GET' && request.url?.startsWith(withBase('/plugin/ui-context/page'))) {
      return {
        payload: {
          ok: true,
          data: {
            page_rem_id: 'PAGE-1',
            ui_context: { pageRemId: 'PAGE-1' },
            snapshot: { status: 'ok' },
          },
        },
      };
    }

    if (request.method === 'GET' && request.url?.startsWith(withBase('/plugin/ui-context/focused-rem'))) {
      return {
        payload: {
          ok: true,
          data: {
            focused_rem_id: 'FOCUS-1',
            ui_context: { focusedRemId: 'FOCUS-1' },
            snapshot: { status: 'ok' },
          },
        },
      };
    }

    if (request.method === 'GET' && request.url?.startsWith(withBase('/plugin/ui-context/describe'))) {
      return {
        payload: {
          ok: true,
          data: {
            uiContext: { pageRemId: 'PAGE-1', focusedRemId: 'FOCUS-1' },
            selection: { kind: 'none', updatedAt: 1 },
            ui_snapshot: { status: 'ok' },
            selection_snapshot: { status: 'ok' },
            anchor: { source: 'focus', id: 'FOCUS-1', title: 'Focus title' },
            portal: { kind: 'page', id: 'PAGE-1', title: 'Page title' },
            page: { id: 'PAGE-1', title: 'Page title' },
            focus: { id: 'FOCUS-1', title: 'Focus title' },
            selection_items: { kind: 'none', total_count: 0, truncated: false, limit: 5, shown: [] },
          },
        },
      };
    }

    if (request.method === 'GET' && request.url?.startsWith(withBase('/plugin/current'))) {
      return {
        payload: {
          ok: true,
          data: {
            page: { id: 'PAGE-1' },
            focus: { id: 'SEL-1' },
            current: { source: 'selection', id: 'SEL-1' },
            selection: {
              kind: 'rem',
              total_count: 1,
              truncated: false,
              ids: ['SEL-1'],
              shown: [{ id: 'SEL-1', title: 'Selected Rem' }],
            },
          },
        },
      };
    }

    if (request.method === 'GET' && request.url?.startsWith(withBase('/plugin/selection/current'))) {
      return {
        payload: {
          ok: true,
          data: {
            selection_kind: 'rem',
            selection_type: 'Rem',
            total_count: 1,
            truncated: false,
            ids: ['SEL-1'],
            current: { id: 'SEL-1', title: 'Selected Rem' },
            page: { id: 'PAGE-1', title: 'Page Title' },
            focus: { id: 'SEL-1', title: 'Selected Rem' },
          },
        },
      };
    }

    if (request.method === 'GET' && request.url?.startsWith(withBase('/plugin/selection/snapshot'))) {
      return {
        payload: {
          ok: true,
          data: {
            status: 'ok',
            state_file: '/tmp/ws.state.json',
            updatedAt: 1,
            now: 2,
            stale_ms: 60_000,
            clients: 1,
            selection: {
              kind: 'rem',
              totalCount: 1,
              truncated: false,
              remIds: ['SEL-1'],
              updatedAt: 1,
            },
          },
        },
      };
    }

    if (request.method === 'GET' && request.url?.startsWith(withBase('/plugin/selection/roots'))) {
      return {
        payload: {
          ok: true,
          data: {
            selection_type: 'Rem',
            total_count: 1,
            truncated: false,
            ids: ['SEL-1'],
          },
        },
      };
    }

    if (request.method === 'GET' && request.url?.startsWith(withBase('/plugin/selection/current'))) {
      return {
        payload: {
          ok: true,
          data: {
            selection_kind: 'rem',
            selection_type: 'Rem',
            total_count: 1,
            truncated: false,
            ids: ['SEL-1'],
            current: { id: 'SEL-1', title: 'Selected Rem' },
            page: { id: 'PAGE-1', title: 'Page Title' },
            focus: { id: 'SEL-1', title: 'Selected Rem' },
          },
        },
      };
    }

    if (request.method === 'POST' && request.url === withBase('/plugin/selection/outline')) {
      return {
        payload: {
          ok: true,
          data: {
            selection: {
              totalCount: 1,
              remIds: ['SEL-1'],
            },
            exported_node_count: 1,
            truncated: false,
            roots: [{ rootId: 'SEL-1', title: 'Selected Rem', markdown: '- Selected Rem' }],
          },
        },
      };
    }

    if (request.method === 'POST' && request.url === withBase('/selection/stable-sibling-range')) {
      return {
        payload: {
          ok: true,
          data: {
            orderedRemIds: Array.isArray(request.body?.remIds) ? request.body.remIds : ['SEL-1'],
            parentId: 'PARENT-1',
            position: 0,
          },
        },
      };
    }

    if (request.method === 'POST' && request.url === withBase('/write/apply')) {
      return {
        payload: {
          ok: true,
          data: {
            txn_id: 'txn-1',
            op_ids: ['op-1'],
            notified: true,
            sent: 1,
            id_map: [],
          },
        },
      };
    }

    if (request.method === 'POST' && request.url === withBase('/queue/wait')) {
      return {
        payload: {
          ok: true,
          data: {
            txn_id: request.body?.txnId ?? 'txn-1',
            status: 'succeeded',
            ops_total: 1,
            ops_succeeded: 1,
            ops_failed: 0,
            ops_dead: 0,
            ops_in_flight: 0,
            score: 100,
            is_done: true,
            is_success: true,
            elapsed_ms: 1,
            id_map: [],
          },
        },
      };
    }

    if (request.method === 'GET' && request.url === withBase('/queue/txns/txn-1')) {
      return {
        payload: {
          ok: true,
          data: {
            txn: { txn_id: 'txn-1', status: 'succeeded' },
            ops: [],
            id_map: [],
          },
        },
      };
    }

    return undefined;
  });
}
