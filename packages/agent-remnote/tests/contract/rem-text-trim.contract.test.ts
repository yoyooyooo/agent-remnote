import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: rem set-text trims boundary blank lines', () => {
  it('removes leading/trailing blank lines from payload.text (dry-run)', async () => {
    const res = await runCli(['--json', 'rem', 'set-text', '--rem', 'REM_ID', '--text', '\n\nhello\n\n', '--dry-run'], {
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
    const res = await runCli(['--json', 'rem', 'text', '--rem', 'REM_ID', '--text', '\n\nhello\n\n', '--dry-run'], {
      env: { REMNOTE_TMUX_REFRESH: '0' },
      timeoutMs: 15_000,
    });

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(String(parsed.error?.message ?? '')).toContain('Invalid subcommand for rem');
  });

  it('fails fast in remote mode because rem set-text is local-only', async () => {
    const res = await runCli(
      ['--json', '--api-base-url', 'http://127.0.0.1:9', 'rem', 'set-text', '--rem', 'REM_ID', '--text', 'hello'],
      {
        timeoutMs: 15_000,
      },
    );

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(String(parsed.error?.message ?? '')).toContain('apiBaseUrl');
    expect(String(parsed.error?.message ?? '')).toContain('rem set-text');
  });
});
