import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { runCli } from '../helpers/runCli.js';

describe('contract: statusLine file mode', () => {
  it('writes `WSx` and `↓N` when daemon/state is unavailable', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    try {
      const storeDb = path.join(tmpDir, 'store.sqlite');
      const statusLineFile = path.join(tmpDir, 'status-line.txt');
      const wsStateFile = path.join(tmpDir, 'ws.bridge.state.json');
      const payloadPath = path.join(tmpDir, 'payload.json');

      await fs.writeFile(
        payloadPath,
        JSON.stringify({
          version: 1,
          kind: 'ops',
          ops: [
            {
              type: 'replace_selection_with_markdown',
              payload: {
                markdown: 'x',
                target: { mode: 'explicit', remIds: ['test'] },
                requireSameParent: true,
                requireContiguous: true,
              },
            },
          ],
        }),
        'utf8',
      );

      const res = await runCli(
        ['--json', 'apply', '--payload', `@${payloadPath}`, '--no-notify', '--no-ensure-daemon'],
        {
          env: {
            REMNOTE_STORE_DB: storeDb,
            REMNOTE_STATUS_LINE_FILE: statusLineFile,
            REMNOTE_WS_STATE_FILE: wsStateFile,
            REMNOTE_TMUX_REFRESH: '0',
          },
        },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const raw = await fs.readFile(statusLineFile, 'utf8');
      const text = raw.trim();
      expect(text).toContain('WSx');
      expect(text).toContain('↓1');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
