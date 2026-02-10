import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: read ui-context describe', () => {
  it('prints a single json envelope and keeps stderr empty when the state file is missing', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const missingState = path.join(tmpDir, 'missing-ws.bridge.state.json');

    try {
      const res = await runCli(['--json', 'plugin', 'ui-context', 'describe', '--state-file', missingState], {
        env: {
          REMNOTE_WS_STATE_FILE: '0',
          WS_STATE_FILE: '0',
          REMNOTE_DB: '',
        },
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.ui_snapshot.status).toBe('down');
      expect(parsed.data.selection_snapshot.status).toBe('down');
      expect(parsed.data.portal.kind).toBe('unknown');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
