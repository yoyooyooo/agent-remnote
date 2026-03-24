import { describe, expect, it } from 'vitest';

import { startJsonApiStub } from '../helpers/httpApiStub.js';
import { runCli } from '../helpers/runCli.js';

async function startApiStub() {
  return await startJsonApiStub((request) => {
    if (request.method === 'POST' && request.url === '/v1/read/by-reference') {
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

    if (request.method === 'POST' && request.url === '/v1/read/references') {
      return {
        payload: {
          ok: true,
          data: {
            id: 'RID-1',
            outbound: [{ id: 'RID-2', text: 'Target' }],
          },
        },
      };
    }

    if (request.method === 'POST' && request.url === '/v1/read/query') {
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

    return undefined;
  });
}

describe('cli contract: reference graph remote api mode', () => {
  it('routes rem by-reference through host api when apiBaseUrl is configured', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(
        ['--json', '--api-base-url', api.baseUrl, 'rem', 'by-reference', '--reference', 'RID-1', '--limit', '7'],
        {
          timeoutMs: 15_000,
        },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.items[0].title).toBe('Inbound Ref');
      expect(api.requests).toHaveLength(1);
      expect(api.requests[0]?.url).toBe('/v1/read/by-reference');
      expect(api.requests[0]?.body).toMatchObject({ reference: ['RID-1'], limit: 7 });
    } finally {
      await api.close();
    }
  });

  it('routes rem references through host api when apiBaseUrl is configured', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(
        ['--json', '--api-base-url', api.baseUrl, 'rem', 'references', '--id', 'RID-1', '--include-inbound'],
        {
          timeoutMs: 15_000,
        },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.outbound[0].id).toBe('RID-2');
      expect(api.requests).toHaveLength(1);
      expect(api.requests[0]?.url).toBe('/v1/read/references');
      expect(api.requests[0]?.body).toMatchObject({ id: 'RID-1', includeInbound: true });
    } finally {
      await api.close();
    }
  });

  it('routes query through host api when apiBaseUrl is configured', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(
        ['--json', '--api-base-url', api.baseUrl, 'query', '--text', 'hello', '--limit', '5'],
        {
          timeoutMs: 15_000,
        },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.items[0].title).toBe('Query Match');
      expect(api.requests).toHaveLength(1);
      expect(api.requests[0]?.url).toBe('/v1/read/query');
      expect(api.requests[0]?.body.limit).toBe(5);
      expect(api.requests[0]?.body?.query).toMatchObject({
        version: 2,
        root: { type: 'text', value: 'hello', mode: 'contains' },
      });
      expect(api.requests[0]?.body?.queryObj).toBeUndefined();
    } finally {
      await api.close();
    }
  });
});
