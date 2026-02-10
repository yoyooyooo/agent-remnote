import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: plugin selection outline invalid max-depth', () => {
  it('returns INVALID_ARGS (exitCode=2) when max-depth exceeds tool limit', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'agent-remnote-test-'));
    const stateFile = path.join(tmp, 'ws.bridge.state.json');

    const now = Date.now();
    await writeFile(
      stateFile,
      JSON.stringify(
        {
          updatedAt: now,
          activeWorkerConnId: 'c1',
          clients: [
            {
              connId: 'c1',
              isActiveWorker: true,
              selection: {
                kind: 'rem',
                selectionType: 'Rem',
                totalCount: 1,
                truncated: false,
                remIds: ['RID'],
                updatedAt: now,
              },
              uiContext: { updatedAt: now },
            },
          ],
        },
        null,
        2,
      ),
    );

    const res = await runCli(
      ['--json', 'plugin', 'selection', 'outline', '--state-file', stateFile, '--max-depth', '11'],
      { env: { REMNOTE_WS_STATE_FILE: stateFile, REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 15_000 },
    );

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe('INVALID_ARGS');
    expect(String(parsed.error?.message ?? '')).toContain('maxDepth');
  });
});

