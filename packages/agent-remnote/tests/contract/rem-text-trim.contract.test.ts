import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: rem set-text trims boundary blank lines', () => {
  it('removes leading/trailing blank lines from payload.text (dry-run)', async () => {
    const res = await runCli(
      ['--json', 'rem', 'set-text', '--rem', 'REM_ID', '--text', '\n\nhello\n\n', '--dry-run'],
      { env: { REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 15_000 },
    );

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.dry_run).toBe(true);
    expect(parsed.data?.ops?.[0]?.type).toBe('update_text');
    expect(parsed.data?.ops?.[0]?.payload?.text).toBe('hello');
  });
});
