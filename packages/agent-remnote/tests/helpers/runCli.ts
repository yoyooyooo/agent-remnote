import { spawn } from 'node:child_process';
import path from 'node:path';
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

  return await new Promise<RunCliResult>((resolve) => {
    const child = spawn('node', ['--import', 'tsx', entry, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...options?.env },
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
      resolve({ exitCode: typeof code === 'number' ? code : 1, stdout, stderr });
    });
  });
}
