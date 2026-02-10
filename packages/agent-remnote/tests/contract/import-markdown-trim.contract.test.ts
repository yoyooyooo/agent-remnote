import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: import markdown trims boundary blank lines', () => {
  it('removes leading/trailing blank lines from payload.markdown (dry-run)', async () => {
    const md = '\n\n- root\n  - child\n\n';
    const res = await runCli(
      ['--json', 'import', 'markdown', '--parent', 'PARENT_ID', '--markdown', md, '--dry-run'],
      { env: { REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 15_000 },
    );

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.dry_run).toBe(true);
    expect(parsed.data?.ops?.[0]?.type).toBe('create_tree_with_markdown');
    expect(parsed.data?.ops?.[0]?.payload?.markdown).toBe('- root\n  - child');
  });
});

