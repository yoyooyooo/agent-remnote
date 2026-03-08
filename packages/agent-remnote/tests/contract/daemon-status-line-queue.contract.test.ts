import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: daemon status-line queue indicator', () => {
  it('appends ↓N when queue has outstanding ops', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'agent-remnote-test-'));
    const storeDb = path.join(tmp, 'store.sqlite');
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
              selection: { kind: 'none', updatedAt: now },
              uiContext: { updatedAt: now },
            },
          ],
        },
        null,
        2,
      ),
    );

    const payload = JSON.stringify([
      { type: 'test_op', payload: {} },
      { type: 'test_op', payload: {} },
    ]);

    const env = { REMNOTE_TMUX_REFRESH: '0' };

    const enqueueRes = await runCli(['--store-db', storeDb, 'apply', '--no-notify', '--payload', payload], {
      env,
      timeoutMs: 15_000,
    });
    expect(enqueueRes.exitCode).toBe(0);

    const statusRes = await runCli(['--store-db', storeDb, 'daemon', 'status-line', '--state-file', stateFile], {
      env,
      timeoutMs: 15_000,
    });

    expect(statusRes.exitCode).toBe(0);
    expect(statusRes.stderr).toBe('');
    expect(statusRes.stdout.trim()).toBe('RN ↓2');
  }, 20_000);
});
