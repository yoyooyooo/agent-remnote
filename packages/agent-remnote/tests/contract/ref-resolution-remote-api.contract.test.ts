import { describe, expect, it } from 'vitest';

import { startJsonApiStub } from '../helpers/httpApiStub.js';
import { runCli } from '../helpers/runCli.js';

async function startApiStub() {
  return await startJsonApiStub((request) => {
    if (request.method === 'POST' && request.url === '/v1/read/page-id') {
      return {
        payload: {
          ok: true,
          data: {
            results: [{ input: 'page:Inbox', found: true, pageId: 'PAGE-1' }],
          },
        },
      };
    }

    if (request.method === 'POST' && request.url === '/v1/read/resolve-ref') {
      return {
        payload: {
          ok: true,
          data: {
            results: [{ remId: 'RID-1', references: [{ id: 'RID-2', text: 'Target' }] }],
          },
        },
      };
    }

    return undefined;
  });
}

describe('cli contract: ref resolution remote api mode', () => {
  it('routes rem page-id through host api when apiBaseUrl is configured', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(['--json', '--api-base-url', api.baseUrl, 'rem', 'page-id', '--ref', 'page:Inbox'], {
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.results[0].pageId).toBe('PAGE-1');
      expect(api.requests).toHaveLength(1);
      expect(api.requests[0]?.url).toBe('/v1/read/page-id');
      expect(api.requests[0]?.body).toMatchObject({ ref: 'page:Inbox' });
    } finally {
      await api.close();
    }
  });

  it('routes rem resolve-ref through host api when apiBaseUrl is configured', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(
        ['--json', '--api-base-url', api.baseUrl, 'rem', 'resolve-ref', '--ids', 'RID-1', '--detail'],
        {
          timeoutMs: 15_000,
        },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.results[0].references[0].id).toBe('RID-2');
      expect(api.requests).toHaveLength(1);
      expect(api.requests[0]?.url).toBe('/v1/read/resolve-ref');
      expect(api.requests[0]?.body).toMatchObject({ ids: ['RID-1'], detail: true });
    } finally {
      await api.close();
    }
  });
});
