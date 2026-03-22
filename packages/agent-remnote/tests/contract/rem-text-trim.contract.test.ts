import { describe, expect, it } from 'vitest';

import { startJsonApiStub } from '../helpers/httpApiStub.js';
import { runCli } from '../helpers/runCli.js';

async function startApiStub() {
  return await startJsonApiStub((request) => {
    if (request.method === 'POST' && request.url === '/v1/write/apply') {
      return {
        payload: { ok: true, data: { txn_id: 'txn-set-text', op_ids: ['op-1'], notified: true, sent: 1 } },
      };
    }
    if (request.method === 'POST' && request.url === '/v1/queue/wait') {
      return {
        payload: {
          ok: true,
          data: {
            txn_id: 'txn-set-text',
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
}

describe('cli contract: rem set-text trims boundary blank lines', () => {
  it('removes leading/trailing blank lines from payload.text (dry-run)', async () => {
    const res = await runCli(['--json', 'rem', 'set-text', '--subject', 'REM_ID', '--text', '\n\nhello\n\n', '--dry-run'], {
      env: { REMNOTE_TMUX_REFRESH: '0' },
      timeoutMs: 15_000,
    });

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.dry_run).toBe(true);
    expect(parsed.data?.ops?.[0]?.type).toBe('update_text');
    expect(parsed.data?.ops?.[0]?.payload?.text).toBe('hello');
  });

  it('rejects rem text alias and keeps only rem set-text', async () => {
    const res = await runCli(['--json', 'rem', 'text', '--subject', 'REM_ID', '--text', '\n\nhello\n\n', '--dry-run'], {
      env: { REMNOTE_TMUX_REFRESH: '0' },
      timeoutMs: 15_000,
    });

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(String(parsed.error?.message ?? '')).toContain('Invalid subcommand for rem');
  });

  it('routes rem set-text through host api when apiBaseUrl is configured', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(
        ['--json', '--api-base-url', api.baseUrl, 'rem', 'set-text', '--subject', 'REM_ID', '--text', 'hello', '--wait'],
        {
          timeoutMs: 15_000,
        },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.txn_id).toBe('txn-set-text');
      expect(api.requests).toHaveLength(2);
      expect(api.requests[0]?.url).toBe('/v1/write/apply');
      expect(api.requests[0]?.body?.ops?.[0]?.type).toBe('update_text');
      expect(api.requests[1]?.url).toBe('/v1/queue/wait');
    } finally {
      await api.close();
    }
  });
});
