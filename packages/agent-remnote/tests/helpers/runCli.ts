import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type RunCliResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export async function runCli(
  args: readonly string[],
  options?: { readonly env?: NodeJS.ProcessEnv; readonly stdin?: string; readonly timeoutMs?: number },
): Promise<RunCliResult> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, '../../../../');
  const entry = path.join(repoRoot, 'packages/agent-remnote/src/main.ts');

  const timeoutMs = options?.timeoutMs ?? 30_000;
  const isolatedHome = options?.env?.HOME ? undefined : await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-test-home-'));
  const env = {
    ...process.env,
    ...(isolatedHome ? { HOME: isolatedHome } : {}),
    ...options?.env,
  };

  return await new Promise<RunCliResult>((resolve) => {
    const child = spawn('node', ['--import', 'tsx', entry, ...args], {
      cwd: repoRoot,
      env,
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
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
      const finalize = async () => {
        if (isolatedHome) {
          try {
            await fs.rm(isolatedHome, { recursive: true, force: true });
          } catch {}
        }
        resolve({ exitCode: typeof code === 'number' ? code : 1, stdout, stderr });
      };
      void finalize();
    });
  });
}
