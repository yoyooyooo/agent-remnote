import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: --payload - stdin', () => {
  it('reads payload from stdin in dry-run mode', async () => {
    const stdin = '{"version":1,"kind":"ops","ops":[{"type":"create_rem","payload":{"fooBar":1}}]}';

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', '-'], { stdin });

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.dry_run).toBe(true);
    expect(parsed.data.ops[0].type).toBe('create_rem');
    expect(parsed.data.ops[0].payload.foo_bar).toBe(1);
  });
});
