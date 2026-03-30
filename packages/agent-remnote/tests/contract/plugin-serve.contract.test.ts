import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';

import { ENSURE_PLUGIN_ARTIFACTS_HOOK_TIMEOUT_MS, ensurePluginArtifacts } from '../helpers/ensurePluginArtifacts.js';

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function repoRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(__filename), '../../../../');
}

async function waitForServer(url: string, timeoutMs = 10_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'server did not start'));
}

async function waitForText(read: () => string, pattern: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (read().includes(pattern)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for text: ${pattern}`);
}

describe('cli contract: plugin serve', () => {
  const children = new Set<ChildProcessWithoutNullStreams>();

  beforeAll(async () => {
    await ensurePluginArtifacts();
  }, ENSURE_PLUGIN_ARTIFACTS_HOOK_TIMEOUT_MS);

  afterEach(async () => {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      try {
        child.kill('SIGTERM');
      } catch {}
      await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(undefined), 2_000);
        child.once('close', () => {
          clearTimeout(timer);
          resolve(undefined);
        });
      });
    }
    children.clear();
  });

  it('serves plugin static assets on the requested host/port', async () => {
    const port = await getFreePort();
    const cwd = repoRoot();
    const entry = path.join(cwd, 'packages/agent-remnote/src/main.ts');
    const child = spawn('node', ['--import', 'tsx', entry, '--json', 'plugin', 'serve', '--port', String(port)], {
      cwd,
      env: {
        ...process.env,
        REMNOTE_TMUX_REFRESH: '0',
      },
      stdio: 'pipe',
    });
    children.add(child);

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    const manifestRes = await waitForServer(`http://127.0.0.1:${port}/manifest.json`);
    expect(manifestRes.status).toBe(200);
    const manifest = await manifestRes.json();
    expect(manifest.id).toBe('agent-remnote-bridge');

    const sandboxRes = await fetch(`http://127.0.0.1:${port}/index-sandbox.js`);
    expect(sandboxRes.status).toBe(200);
    expect(await sandboxRes.text()).toContain('declareIndexPlugin');

    expect(stderr).toBe('');
  }, 20_000);

  it('prints vite-like local URL output in human mode', async () => {
    const port = await getFreePort();
    const cwd = repoRoot();
    const entry = path.join(cwd, 'packages/agent-remnote/src/main.ts');
    const child = spawn('node', ['--import', 'tsx', entry, 'plugin', 'serve', '--port', String(port)], {
      cwd,
      env: {
        ...process.env,
        REMNOTE_TMUX_REFRESH: '0',
      },
      stdio: 'pipe',
    });
    children.add(child);

    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    const manifestRes = await waitForServer(`http://127.0.0.1:${port}/manifest.json`);
    expect(manifestRes.status).toBe(200);

    await waitForText(() => stdout, 'agent-remnote plugin ready');
    await waitForText(() => stdout, `Local:   http://127.0.0.1:${port}/`);

    expect(stdout).toContain('agent-remnote plugin ready');
    expect(stdout).toContain(`Local:   http://127.0.0.1:${port}/`);
    expect(stdout).not.toContain('Dist:');
  }, 20_000);

  it('prints dist path in debug mode', async () => {
    const port = await getFreePort();
    const cwd = repoRoot();
    const entry = path.join(cwd, 'packages/agent-remnote/src/main.ts');
    const child = spawn('node', ['--import', 'tsx', entry, '--debug', 'plugin', 'serve', '--port', String(port)], {
      cwd,
      env: {
        ...process.env,
        REMNOTE_TMUX_REFRESH: '0',
      },
      stdio: 'pipe',
    });
    children.add(child);

    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    const manifestRes = await waitForServer(`http://127.0.0.1:${port}/manifest.json`);
    expect(manifestRes.status).toBe(200);

    await waitForText(() => stdout, 'agent-remnote plugin ready');
    await waitForText(() => stdout, `Local:   http://127.0.0.1:${port}/`);
    await waitForText(() => stdout, 'Dist:    ');

    expect(stdout).toContain('agent-remnote plugin ready');
    expect(stdout).toContain(`Local:   http://127.0.0.1:${port}/`);
    expect(stdout).toContain('Dist:    ');
  }, 20_000);
});
