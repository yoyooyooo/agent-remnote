import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: write md --dry-run --json', () => {
  it('accepts inline markdown via --markdown', async () => {
    const res = await runCli([
      '--json',
      'import',
      'markdown',
      '--ref',
      'page:demo',
      '--markdown',
      '- a\\n  - b\\n',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.dry_run).toBe(true);
    expect(parsed.data.ops).toHaveLength(1);
    expect(parsed.data.ops[0].type).toBe('create_tree_with_markdown');
    expect(parsed.data.ops[0].payload.markdown).toBe('- a\\n  - b\\n');
  });
});
