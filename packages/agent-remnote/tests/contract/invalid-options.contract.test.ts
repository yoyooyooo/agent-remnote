import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: invalid options', () => {
  it('rejects an unknown top-level option', async () => {
    const res = await runCli(['--wat']);

    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe('');
    expect(res.stderr).toMatch(/^Error:/);
    expect(res.stderr).toContain("Received unknown argument: '--wat'");
  });

  it('rejects an unknown top-level option even when a valid command follows', async () => {
    const res = await runCli(['--wat', 'search']);

    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe('');
    expect(res.stderr).toMatch(/^Error:/);
    expect(res.stderr).toContain("Received unknown argument: '--wat'");
  });

  it('rejects a global option placed after the first subcommand token', async () => {
    const res = await runCli(['plugin', '--md', 'ui-context', 'describe']);

    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe('');
    expect(res.stderr).toMatch(/^Error:/);
    expect(res.stderr).toContain("Global option '--md' must be specified before the first subcommand");
  });

  it('rejects an unknown option placed between subcommand tokens', async () => {
    const res = await runCli(['plugin', '--wat', 'ui-context', 'describe']);

    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe('');
    expect(res.stderr).toMatch(/^Error:/);
    expect(res.stderr).toContain("Unexpected option '--wat' before specifying a subcommand for plugin");
  });

  it('keeps --json as a strict protocol (rejects --help)', async () => {
    const res = await runCli(['--json', '--help']);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_ARGS');
    expect(parsed.error.message).toContain("Option '--json' cannot be combined");
  });

  it('keeps --json stderr empty on @effect/cli validation errors', async () => {
    const res = await runCli(['--json', 'search']);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_ARGS');
    expect(parsed.error.message).toContain('--query');
  });
});
