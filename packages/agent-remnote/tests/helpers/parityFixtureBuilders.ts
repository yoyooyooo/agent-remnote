import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

export async function createPluginSelectionStateFile(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-parity-selection-'));
  const statePath = path.join(tmpDir, 'ws.bridge.state.json');
  const now = Date.now();

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
              remIds: ['SEL-1'],
              updatedAt: now - 500,
            },
            uiContext: {
              updatedAt: now - 500,
              pageRemId: 'PAGE-1',
              focusedRemId: 'SEL-1',
            },
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  return statePath;
}
