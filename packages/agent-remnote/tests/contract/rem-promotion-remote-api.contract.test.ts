import { describe, expect, it } from 'vitest';

import { startJsonApiStub } from '../helpers/httpApiStub.js';
import { runCli } from '../helpers/runCli.js';

describe('cli contract: rem promotion remote api mode', () => {
  it('routes rem move anchor placement through host api when apiBaseUrl is configured', async () => {
    const api = await startJsonApiStub((request) => {
      if (request.method === 'POST' && request.url === '/v1/placement/resolve') {
        return {
          payload: {
            ok: true,
            data: { kind: 'after', parentId: 'PARENT-1', position: 8 },
          },
        };
      }
      if (request.method === 'POST' && request.url === '/v1/write/apply') {
        return {
          payload: {
            ok: true,
            data: { txn_id: 'txn-move', op_ids: ['op-1'], notified: true, sent: 1, id_map: [] },
          },
        };
      }
      if (request.method === 'POST' && request.url === '/v1/queue/wait') {
        return {
          payload: {
            ok: true,
            data: {
              txn_id: 'txn-move',
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
      return undefined;
    });

    try {
      const res = await runCli(
        ['--json', '--api-base-url', api.baseUrl, 'rem', 'move', '--subject', 'id:r1', '--at', 'after:id:a1', '--wait'],
        { timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(api.requests.map((request) => request.url)).toEqual([
        '/v1/placement/resolve',
        '/v1/write/apply',
        '/v1/queue/wait',
        '/v1/queue/txns/txn-move',
      ]);
      expect(api.requests[1]?.body?.kind).toBe('actions');
      expect(api.requests[1]?.body?.actions?.[0]?.action).toBe('rem.move');
      expect(api.requests[1]?.body?.actions?.[0]?.input?.new_parent_id).toBe('PARENT-1');
      expect(api.requests[1]?.body?.actions?.[0]?.input?.position).toBe(8);
    } finally {
      await api.close();
    }
  });

  it('routes rem create with remote ref resolution through host api when apiBaseUrl is configured', async () => {
    const api = await startJsonApiStub((request) => {
      if (request.method === 'POST' && request.url === '/v1/ref/resolve') {
        return {
          payload: {
            ok: true,
            data: { remId: request.body?.ref === 'page:Inbox' ? 'PAGE-1' : 'RID-X' },
          },
        };
      }
      if (request.method === 'POST' && request.url === '/v1/write/apply') {
        return {
          payload: {
            ok: true,
            data: { txn_id: 'txn-create', op_ids: ['op-1'], notified: true, sent: 1, id_map: [] },
          },
        };
      }
      if (request.method === 'POST' && request.url === '/v1/queue/wait') {
        return {
          payload: {
            ok: true,
            data: {
              txn_id: 'txn-create',
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
      return undefined;
    });

    try {
      const res = await runCli(
        [
          '--json',
          '--api-base-url',
          api.baseUrl,
          'rem',
          'create',
          '--text',
          'hello',
          '--at',
          'parent:page:Inbox',
          '--wait',
        ],
        { timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(api.requests.map((request) => request.url)).toEqual([
        '/v1/ref/resolve',
        '/v1/write/apply',
        '/v1/queue/wait',
      ]);
      expect(api.requests[1]?.body?.ops?.[0]?.type).toBe('create_rem');
      expect(api.requests[1]?.body?.ops?.[0]?.payload?.parent_id).toBe('PAGE-1');
    } finally {
      await api.close();
    }
  });

  it('routes rem create from selection with portal in-place through host api when apiBaseUrl is configured', async () => {
    const api = await startJsonApiStub((request) => {
      if (request.method === 'GET' && request.url?.startsWith('/v1/plugin/selection/current')) {
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
              page: { id: 'PAGE-1', title: 'Inbox' },
              focus: { id: 'SEL-1', title: 'Selected Rem' },
            },
          },
        };
      }
      if (request.method === 'POST' && request.url === '/v1/selection/stable-sibling-range') {
        return {
          payload: {
            ok: true,
            data: {
              orderedRemIds: ['SEL-1'],
              parentId: 'PARENT-1',
              position: 4,
            },
          },
        };
      }
      if (request.method === 'POST' && request.url === '/v1/write/apply') {
        return {
          payload: {
            ok: true,
            data: {
              txn_id: 'txn-create-selection',
              op_ids: ['op-1', 'op-2', 'op-3'],
              notified: true,
              sent: 1,
              id_map: [],
            },
          },
        };
      }
      if (request.method === 'POST' && request.url === '/v1/queue/wait') {
        return {
          payload: {
            ok: true,
            data: {
              txn_id: 'txn-create-selection',
              status: 'succeeded',
              ops_total: 3,
              ops_succeeded: 3,
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
      return undefined;
    });

    try {
      const res = await runCli(
        [
          '--json',
          '--api-base-url',
          api.baseUrl,
          'rem',
          'create',
          '--from-selection',
          '--portal',
          'in-place',
          '--at',
          'parent:id:DEST-1',
          '--wait',
        ],
        { timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(api.requests.map((request) => request.url)).toEqual([
        '/v1/plugin/selection/current',
        '/v1/selection/stable-sibling-range',
        '/v1/write/apply',
        '/v1/queue/wait',
      ]);
      expect(api.requests[1]?.body).toMatchObject({
        remIds: ['SEL-1'],
      });
      expect(api.requests[2]?.body?.ops?.some((op: any) => op?.type === 'create_portal')).toBe(true);
    } finally {
      await api.close();
    }
  });
});
