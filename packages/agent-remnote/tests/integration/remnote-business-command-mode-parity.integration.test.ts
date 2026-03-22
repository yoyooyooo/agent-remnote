import { describe, expect, it } from 'vitest';

import { startParityApiHarness } from '../helpers/remoteModeHarness.js';
import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('integration: remnote business command mode parity', () => {
  it.each(['/v1', '/remnote/v1'])('runs representative Wave 1 commands through remote mode under %s', async (basePath) => {
    const api = await startParityApiHarness(basePath);
    try {
      const search = await runCli(['--json', '--api-base-url', api.baseUrl, 'search', '--query', 'hello'], {
        env: { REMNOTE_API_BASE_PATH: basePath },
        timeoutMs: 15_000,
      });
      const daily = await runCli(['--json', '--api-base-url', api.baseUrl, 'daily', 'rem-id'], {
        env: { REMNOTE_API_BASE_PATH: basePath },
        timeoutMs: 15_000,
      });
      const apply = await runCli(
        [
          '--json',
          '--api-base-url',
          api.baseUrl,
          'apply',
          '--payload',
          JSON.stringify({
            version: 1,
            kind: 'actions',
            actions: [{ action: 'write.bullet', input: { parent_id: 'p1', text: 'hello' } }],
          }),
          '--wait',
        ],
        {
          env: { REMNOTE_API_BASE_PATH: basePath },
          timeoutMs: 15_000,
        },
      );

      expect(search.exitCode).toBe(0);
      expect(daily.exitCode).toBe(0);
      expect(apply.exitCode).toBe(0);
      expect(search.stderr).toBe('');
      expect(daily.stderr).toBe('');
      expect(apply.stderr).toBe('');
      expect(parseJsonLine(search.stdout).ok).toBe(true);
      expect(parseJsonLine(daily.stdout).ok).toBe(true);
      expect(parseJsonLine(apply.stdout).ok).toBe(true);

      expect(api.requests.some((request) => request.url === `${basePath}/search/db`)).toBe(true);
      expect(api.requests.some((request) => request.url?.startsWith(`${basePath}/daily/rem-id`))).toBe(true);
      expect(api.requests.some((request) => request.url === `${basePath}/write/apply`)).toBe(true);
      expect(api.requests.some((request) => request.url === `${basePath}/queue/wait`)).toBe(true);
    } finally {
      await api.close();
    }
  });
});
