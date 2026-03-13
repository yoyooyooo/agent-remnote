import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function repoRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(__filename), '../../../../');
}

function artifactsReady(root: string): boolean {
  const distPath = path.join(root, 'packages/agent-remnote/plugin-artifacts/dist');
  return existsSync(path.join(distPath, 'manifest.json')) && existsSync(path.join(distPath, 'index-sandbox.js'));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensurePluginArtifacts(): Promise<void> {
  const root = repoRoot();
  if (artifactsReady(root)) return;

  const lockPath = path.join(root, 'packages/agent-remnote/plugin-artifacts/.prepare.lock');

  while (true) {
    try {
      const fs = await import('node:fs/promises');
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      const handle = await fs.open(lockPath, 'wx');
      try {
        if (!artifactsReady(root)) {
          await new Promise<void>((resolve, reject) => {
            const child = spawn('node', ['--import', 'tsx', './packages/agent-remnote/scripts/prepare-plugin-artifacts.ts'], {
              cwd: root,
              env: process.env,
              stdio: 'inherit',
            });

            child.once('error', reject);
            child.once('close', (code) => {
              if (code === 0) resolve();
              else reject(new Error(`prepare-plugin-artifacts exited with code ${code ?? 1}`));
            });
          });
        }
      } finally {
        await handle.close();
        await fs.rm(lockPath, { force: true });
      }
      return;
    } catch (error) {
      const code = (error as any)?.code;
      if (code !== 'EEXIST') throw error;
      if (artifactsReady(root)) return;
      await sleep(200);
    }
  }
}
