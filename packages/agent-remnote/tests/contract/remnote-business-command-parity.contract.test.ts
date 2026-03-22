import { describe, expect, it } from 'vitest';

import { wave1RemnoteBusinessCommandContractIds } from '../helpers/remnoteBusinessCommandContracts.js';
import { expectParityEqual } from '../helpers/parityComparison.js';
import { createPluginSelectionStateFile } from '../helpers/parityFixtureBuilders.js';
import { startParityApiHarness } from '../helpers/remoteModeHarness.js';
import { wave1RemnoteBusinessCommandVerificationCases } from '../helpers/remnoteBusinessCommandMatrix.js';
import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('contract: remnote business command parity', () => {
  it('keeps Wave 1 verification-case mapping complete at command level', () => {
    for (const commandId of wave1RemnoteBusinessCommandContractIds) {
      const cases = wave1RemnoteBusinessCommandVerificationCases[commandId];
      expect(Array.isArray(cases)).toBe(true);
      expect(cases.length).toBeGreaterThan(0);
    }
  });

  it('compares local and remote search success semantics', async () => {
    const api = await startParityApiHarness('/v1');
    try {
      const local = await runCli(['--json', '--remnote-db', '/missing/remnote.db', 'search', '--query', 'hello'], {
        timeoutMs: 15_000,
      });
      const remote = await runCli(['--json', '--api-base-url', api.baseUrl, 'search', '--query', 'hello'], {
        timeoutMs: 15_000,
      });

      expect(remote.exitCode).toBe(0);
      expect(remote.stderr).toBe('');
      const parsed = parseJsonLine(remote.stdout);
      expect(parsed.ok).toBe(true);

      expect(local.exitCode).toBe(1);
      expect(local.stderr).toBe('');
      const localParsed = parseJsonLine(local.stdout);
      expect(localParsed.ok).toBe(false);

      expectParityEqual(parsed.data, {
        query: 'hello',
        total: 1,
        items: [{ id: 'RID-1', title: 'Hello' }],
        markdown: '- Hello',
      });
    } finally {
      await api.close();
    }
  });

  it('compares local and remote plugin current success semantics', async () => {
    const stateFile = await createPluginSelectionStateFile();
    const api = await startParityApiHarness('/v1');
    try {
      const local = await runCli(['--json', 'plugin', 'current', '--state-file', stateFile, '--compact'], {
        env: { REMNOTE_WS_STATE_FILE: stateFile, REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 15_000,
      });
      const remote = await runCli(
        ['--json', '--api-base-url', api.baseUrl, 'plugin', 'current', '--state-file', stateFile, '--compact'],
        {
          env: { REMNOTE_WS_STATE_FILE: stateFile, REMNOTE_TMUX_REFRESH: '0' },
          timeoutMs: 15_000,
        },
      );

      expect(local.exitCode).toBe(0);
      expect(remote.exitCode).toBe(0);
      expect(local.stderr).toBe('');
      expect(remote.stderr).toBe('');

      const localParsed = parseJsonLine(local.stdout);
      const remoteParsed = parseJsonLine(remote.stdout);
      expect(localParsed.ok).toBe(true);
      expect(remoteParsed.ok).toBe(true);
      expectParityEqual(localParsed.data, remoteParsed.data);
    } finally {
      await api.close();
    }
  });

  it('compares local and remote stable-failure semantics for plugin selection outline max-depth validation', async () => {
    const local = await runCli(['--json', 'plugin', 'selection', 'outline', '--max-depth', '11'], {
      timeoutMs: 15_000,
    });
    const api = await startParityApiHarness('/v1');
    try {
      const remote = await runCli(
        ['--json', '--api-base-url', api.baseUrl, 'plugin', 'selection', 'outline', '--max-depth', '11'],
        { timeoutMs: 15_000 },
      );

      expect(local.exitCode).toBe(2);
      expect(remote.exitCode).toBe(2);
      expect(local.stderr).toBe('');
      expect(remote.stderr).toBe('');

      const localParsed = parseJsonLine(local.stdout);
      const remoteParsed = parseJsonLine(remote.stdout);
      expect(localParsed.ok).toBe(false);
      expect(remoteParsed.ok).toBe(false);
      expectParityEqual(
        {
          code: localParsed.error?.code,
          message: localParsed.error?.message,
        },
        {
          code: remoteParsed.error?.code,
          message: remoteParsed.error?.message,
        },
      );
    } finally {
      await api.close();
    }
  });
});
