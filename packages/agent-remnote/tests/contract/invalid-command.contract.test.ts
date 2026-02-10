import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: invalid commands', () => {
  it('rejects an unknown top-level command', async () => {
    const res = await runCli(['foo']);

    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe('');
    expect(res.stderr).toMatch(/^Error:/);
    expect(res.stderr).toContain('Invalid subcommand for agent-remnote');
  });

  it('rejects an invalid nested subcommand at the correct level', async () => {
    const res = await runCli(['plugin', 'ui-context', 'nope']);

    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe('');
    expect(res.stderr).toMatch(/^Error:/);
    expect(res.stderr).toContain("Invalid subcommand for ui-context - use one of 'snapshot', 'page', 'focused-rem'");
  });
});
