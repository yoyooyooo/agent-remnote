import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function runCommand(cmd: string, args: readonly string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, [...args], {
      cwd,
      env: process.env,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code ?? 1}`));
    });
  });
}

async function main(): Promise<void> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(scriptDir, '..');
  const repoRoot = path.resolve(packageRoot, '../..');
  const pluginRoot = path.join(repoRoot, 'packages', 'plugin');
  const pluginDist = path.join(pluginRoot, 'dist');
  const pluginZip = path.join(pluginRoot, 'PluginZip.zip');
  const artifactsRoot = path.join(packageRoot, 'plugin-artifacts');
  const token = `${process.pid}-${Date.now()}`;
  const stagingRoot = `${artifactsRoot}.staging-${token}`;
  const stagingDist = path.join(stagingRoot, 'dist');
  const staleArtifactsRoot = `${artifactsRoot}.stale-${token}`;

  await runCommand(npmCommand(), ['run', 'build', '--workspace', '@remnote/plugin'], repoRoot);

  await fs.rm(stagingRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await fs.mkdir(stagingRoot, { recursive: true });
  await fs.cp(pluginDist, stagingDist, { recursive: true });
  await fs.copyFile(pluginZip, path.join(stagingRoot, 'PluginZip.zip'));

  await fs.rm(staleArtifactsRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  try {
    await fs.rename(artifactsRoot, staleArtifactsRoot);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await fs.rm(staleArtifactsRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  try {
    await fs.rename(stagingRoot, artifactsRoot);
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      await fs.rm(artifactsRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await fs.rename(stagingRoot, artifactsRoot);
    } else {
      throw error;
    }
  }
}

await main();
