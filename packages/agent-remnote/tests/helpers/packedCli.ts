import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export type SpawnResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

const PACK_CACHE_ROOT = path.join(os.tmpdir(), 'agent-remnote-pack-cache');

function repoRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '../../../../');
}

async function latestMtimeMs(targetPath: string): Promise<number> {
  const stat = await fs.stat(targetPath);
  if (!stat.isDirectory()) return Math.floor(stat.mtimeMs);
  let max = Math.floor(stat.mtimeMs);
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.turbo') continue;
    max = Math.max(max, await latestMtimeMs(path.join(targetPath, entry.name)));
  }
  return max;
}

async function packFingerprint(): Promise<string> {
  const root = repoRoot();
  const targets = [
    'packages/agent-remnote/src',
    'packages/agent-remnote/scripts',
    'packages/agent-remnote/package.json',
    'packages/plugin/src',
    'packages/plugin/scripts',
    'packages/plugin/package.json',
  ];
  const hash = createHash('sha256');
  for (const rel of targets) {
    const full = path.join(root, rel);
    try {
      hash.update(rel);
      hash.update(String(await latestMtimeMs(full)));
    } catch {}
  }
  return hash.digest('hex').slice(0, 16);
}

async function spawnAndCapture(
  command: string,
  args: readonly string[],
  options?: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly stdin?: string;
    readonly timeoutMs?: number;
  },
): Promise<SpawnResult> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  return await new Promise<SpawnResult>((resolve) => {
    const child = spawn(command, [...args], {
      cwd: options?.cwd ?? repoRoot(),
      env: { ...process.env, ...options?.env },
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    if (options?.stdin !== undefined) {
      child.stdin.setDefaultEncoding('utf8');
      child.stdin.write(options.stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: typeof code === 'number' ? code : 1, stdout, stderr });
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensurePackedCliCache(): Promise<string> {
  const fingerprint = await packFingerprint();
  const cacheRoot = path.join(PACK_CACHE_ROOT, fingerprint);
  const cacheLock = path.join(cacheRoot, '.lock');
  const cacheTarball = path.join(cacheRoot, 'agent-remnote.tgz');

  await fs.mkdir(cacheRoot, { recursive: true });
  try {
    await fs.access(cacheTarball);
    return cacheTarball;
  } catch {}

  let lockHeld = false;
  for (;;) {
    try {
      await fs.mkdir(cacheLock);
      lockHeld = true;
      break;
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        await fs.access(cacheTarball);
        return cacheTarball;
      } catch {}
      await delay(200);
    }
  }

  try {
    try {
      await fs.access(cacheTarball);
      return cacheTarball;
    } catch {}

    const buildDir = await fs.mkdtemp(path.join(cacheRoot, 'build-'));
    try {
      const res = await spawnAndCapture('npm', ['pack', '--json', '--pack-destination', buildDir, './packages/agent-remnote'], {
        timeoutMs: 180_000,
      });
      if (res.exitCode !== 0) {
        throw new Error(`npm pack failed: ${res.stderr || res.stdout}`);
      }
      const match = res.stdout.match(/(\[\s*\{[\s\S]*\}\s*\])\s*$/);
      if (!match) {
        throw new Error(`npm pack returned non-JSON stdout tail: ${res.stdout}`);
      }
      const parsed = JSON.parse(match[1]) as Array<{ filename: string }>;
      const filename = parsed[0]?.filename;
      if (!filename) {
        throw new Error(`npm pack returned no filename: ${res.stdout}`);
      }
      await fs.copyFile(path.join(buildDir, filename), cacheTarball);
    } finally {
      await fs.rm(buildDir, { recursive: true, force: true });
    }

    return cacheTarball;
  } finally {
    if (lockHeld) {
      await fs.rm(cacheLock, { recursive: true, force: true });
    }
  }
}

export async function packAgentRemnoteCli(): Promise<{ readonly workDir: string; readonly tarballPath: string }> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-pack-'));
  const cachedTarball = await ensurePackedCliCache();
  const tarballPath = path.join(workDir, path.basename(cachedTarball));
  await fs.copyFile(cachedTarball, tarballPath);
  return { workDir, tarballPath };
}

export async function installPackedCli(tarballPath: string): Promise<{ readonly installDir: string; readonly cliPath: string }> {
  const installDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-install-'));
  const res = await spawnAndCapture('npm', ['install', '--prefix', installDir, tarballPath], {
    timeoutMs: 180_000,
  });
  if (res.exitCode !== 0) {
    throw new Error(`npm install failed: ${res.stderr || res.stdout}`);
  }
  return {
    installDir,
    cliPath: path.join(installDir, 'node_modules', 'agent-remnote', 'cli.js'),
  };
}

export async function runInstalledCli(params: {
  readonly cliPath: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly stdin?: string;
  readonly timeoutMs?: number;
}): Promise<SpawnResult> {
  return await spawnAndCapture(process.execPath, [params.cliPath, ...params.args], {
    env: params.env,
    stdin: params.stdin,
    timeoutMs: params.timeoutMs,
  });
}
