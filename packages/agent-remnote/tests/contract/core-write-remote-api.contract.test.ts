import { describe, expect, it } from 'vitest';

import { startJsonApiStub } from '../helpers/httpApiStub.js';
import { runCli } from '../helpers/runCli.js';

async function startApiStub() {
  return await startJsonApiStub((request) => {
    if (request.method === 'POST' && request.url === '/v1/write/apply') {
      const op = request.body?.ops?.[0];
      const type = op?.type;
      const tempId = op?.payload?.client_temp_id;
      return {
        payload: {
          ok: true,
          data: {
            txn_id: `txn-${type}`,
            op_ids: ['op-1'],
            notified: true,
            sent: 1,
            id_map: tempId ? [{ client_temp_id: tempId, remote_id: 'PORTAL-1', remote_type: 'rem' }] : [],
          },
        },
      };
    }

    if (request.method === 'POST' && request.url === '/v1/queue/wait') {
      const txnId = request.body?.txnId;
      const idMap =
        txnId === 'txn-create_portal'
          ? [{ client_temp_id: 'tmp:portal-1', remote_id: 'PORTAL-1', remote_type: 'rem' }]
          : [];
      return {
        payload: {
          ok: true,
          data: {
            txn_id: txnId,
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
            id_map: idMap,
          },
        },
      };
    }

    return undefined;
  });
}

describe('cli contract: core write remote api mode', () => {
  it('routes portal create through host api when apiBaseUrl is configured', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(
        [
          '--json',
          '--api-base-url',
          api.baseUrl,
          'portal',
          'create',
          '--to',
          'id:t1',
          '--at',
          'parent:id:p1',
          '--client-temp-id',
          'tmp:portal-1',
          '--wait',
        ],
        { timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.portal_rem_id).toBe('PORTAL-1');
      expect(api.requests[0]?.url).toBe('/v1/write/apply');
      expect(api.requests[0]?.body?.ops?.[0]?.type).toBe('create_portal');
      expect(api.requests[1]?.url).toBe('/v1/queue/wait');
    } finally {
      await api.close();
    }
  });

  it('routes portal create anchor placement through host api when apiBaseUrl is configured', async () => {
    const api = await startJsonApiStub((request) => {
      if (request.method === 'POST' && request.url === '/v1/placement/resolve') {
        return {
          payload: {
            ok: true,
            data: {
              kind: 'before',
              parentId: 'PARENT-1',
              position: 3,
            },
          },
        };
      }

      if (request.method === 'POST' && request.url === '/v1/write/apply') {
        return {
          payload: {
            ok: true,
            data: {
              txn_id: 'txn-create_portal',
              op_ids: ['op-1'],
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
              txn_id: 'txn-create_portal',
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
        ['--json', '--api-base-url', api.baseUrl, 'portal', 'create', '--to', 'id:t1', '--at', 'before:id:a1', '--wait'],
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
        '/v1/queue/txns/txn-create_portal',
      ]);
      expect(api.requests[1]?.body?.ops?.[0]?.payload?.parent_id).toBe('PARENT-1');
      expect(api.requests[1]?.body?.ops?.[0]?.payload?.position).toBe(3);
    } finally {
      await api.close();
    }
  });

  it('routes rem delete through host api when apiBaseUrl is configured', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(
        ['--json', '--api-base-url', api.baseUrl, 'rem', 'delete', '--subject', 'RID-1', '--wait'],
        { timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.txn_id).toBe('txn-delete_rem');
      expect(api.requests[0]?.url).toBe('/v1/write/apply');
      expect(api.requests[0]?.body?.ops?.[0]?.type).toBe('delete_rem');
      expect(api.requests[1]?.url).toBe('/v1/queue/wait');
    } finally {
      await api.close();
    }
  });
});
