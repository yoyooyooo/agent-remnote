import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

const REMOTE_URL = 'http://127.0.0.1:1';

describe('contract: remnote deferred command remote alignment', () => {
  it.each([
    {
      label: 'table show',
      args: ['--json', '--api-base-url', REMOTE_URL, 'table', 'show', '--id', 'RID-1'],
      code: 'INVALID_ARGS',
      messageIncludes: 'table show is unavailable when apiBaseUrl is configured',
    },
    {
      label: 'powerup list',
      args: ['--json', '--api-base-url', REMOTE_URL, 'powerup', 'list'],
      code: 'INVALID_ARGS',
      messageIncludes: 'powerup list is unavailable when apiBaseUrl is configured',
    },
    {
      label: 'powerup resolve',
      args: ['--json', '--api-base-url', REMOTE_URL, 'powerup', 'resolve', '--powerup', 'Todo'],
      code: 'INVALID_ARGS',
      messageIncludes: 'powerup resolve is unavailable when apiBaseUrl is configured',
    },
    {
      label: 'powerup schema',
      args: ['--json', '--api-base-url', REMOTE_URL, 'powerup', 'schema', '--powerup', 'Todo'],
      code: 'INVALID_ARGS',
      messageIncludes: 'powerup schema is unavailable when apiBaseUrl is configured',
    },
    {
      label: 'rem connections',
      args: ['--json', '--api-base-url', REMOTE_URL, 'rem', 'connections', '--id', 'RID-1'],
      code: 'INVALID_ARGS',
      messageIncludes: 'rem connections is unavailable when apiBaseUrl is configured',
    },
    {
      label: 'daily summary',
      args: ['--json', '--api-base-url', REMOTE_URL, 'daily', 'summary'],
      code: 'INVALID_ARGS',
      messageIncludes: 'daily summary is unavailable when apiBaseUrl is configured',
    },
    {
      label: 'topic summary',
      args: ['--json', '--api-base-url', REMOTE_URL, 'topic', 'summary', '--query', 'agent'],
      code: 'INVALID_ARGS',
      messageIncludes: 'topic summary is unavailable when apiBaseUrl is configured',
    },
    {
      label: 'rem inspect',
      args: ['--json', '--api-base-url', REMOTE_URL, 'rem', 'inspect', '--id', 'RID-1'],
      code: 'INVALID_ARGS',
      messageIncludes: 'rem inspect is unavailable when apiBaseUrl is configured',
    },
    {
      label: 'todos list',
      args: ['--json', '--api-base-url', REMOTE_URL, 'todo', 'list'],
      code: 'INVALID_ARGS',
      messageIncludes: 'todos list is unavailable when apiBaseUrl is configured',
    },
  ])('$label keeps a stable remote failure contract while deferred', async ({ args, code, messageIncludes }) => {
    const res = await runCli(args, { timeoutMs: 15_000 });

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe(code);
    expect(String(parsed.error?.message ?? '')).toContain(messageIncludes);
  });
});
