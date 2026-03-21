import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: rem children prepend', () => {
  it('compiles prepend to create_tree_with_markdown with position 0 (dry-run)', async () => {
    const res = await runCli(
      ['--json', 'rem', 'children', 'prepend', '--subject', 'PARENT_ID', '--markdown', '- hello', '--dry-run'],
      { env: { REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 15_000 },
    );

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.dry_run).toBe(true);
    expect(parsed.data?.ops?.[0]?.type).toBe('create_tree_with_markdown');
    expect(parsed.data?.ops?.[0]?.payload?.position).toBe(0);
  });
});
