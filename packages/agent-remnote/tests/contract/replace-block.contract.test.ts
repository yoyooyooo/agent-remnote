import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: write replace markdown --dry-run --json', () => {
  it('reads selection from ws state file and prints a replace_selection_with_markdown op', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const statePath = path.join(tmpDir, 'ws.bridge.state.json');
    const mdPath = path.join(tmpDir, 'new.md');

    const now = Date.now();

    try {
      await fs.writeFile(mdPath, '- hello\\n  - world\\n', 'utf8');
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            updatedAt: now,
            clients: [
              {
                connId: 'test-conn',
                isActiveWorker: true,
                connectedAt: now - 1000,
                lastSeenAt: now - 500,
                readyState: 1,
                selection: {
                  selectionType: 'Rem',
                  totalCount: 1,
                  truncated: false,
                  remIds: ['B'],
                  updatedAt: now - 500,
                },
              },
            ],
          },
          null,
          2,
        ),
        'utf8',
      );

      const res = await runCli([
        '--json',
        'replace',
        'markdown',
        '--selection',
        '--file',
        '@' + mdPath,
        '--state-file',
        statePath,
        '--dry-run',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.dry_run).toBe(true);
      expect(parsed.data.target.kind).toBe('selection');
      expect(parsed.data.target.rootIds).toEqual(['B']);
      expect(parsed.data.op.type).toBe('replace_selection_with_markdown');
      expect(parsed.data.op.payload.markdown).toBe('- hello\\n  - world\\n');
      expect(parsed.data.op.payload.target.mode).toBe('expected');
      expect(parsed.data.op.payload.target.rem_ids).toEqual(['B']);
      expect(parsed.data.op.payload.require_same_parent).toBe(true);
      expect(parsed.data.op.payload.require_contiguous).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('describes replace markdown as an advanced local-only command in help output', async () => {
    const res = await runCli(['replace', 'markdown', '--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    expect(res.stdout).toContain('advanced/local-only');
    expect(res.stdout).toContain('rem replace');
  });

  it('fails fast in remote mode because replace markdown is local-only', async () => {
    const res = await runCli([
      '--json',
      '--api-base-url',
      'http://127.0.0.1:9',
      'replace',
      'markdown',
      '--selection',
      '--markdown',
      '- hello',
    ]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(String(parsed.error?.message ?? '')).toContain('local-only');
    expect(String(parsed.error?.message ?? '')).toContain('apiBaseUrl');
  });
});
