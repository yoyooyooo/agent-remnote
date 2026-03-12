import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import type { ResolvedConfig } from '../../src/services/Config.js';

export async function waitForPort(port: number, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timeout waiting for port ${port}`);
}

export function overrideHome(tmpHome: string): () => void {
  const previous = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    HOMEDRIVE: process.env.HOMEDRIVE,
    HOMEPATH: process.env.HOMEPATH,
  };

  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete process.env.HOMEDRIVE;
  delete process.env.HOMEPATH;

  return () => {
    const restore = (key: keyof typeof previous) => {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };

    restore('HOME');
    restore('USERPROFILE');
    restore('HOMEDRIVE');
    restore('HOMEPATH');
  };
}

export function makeConfig(
  tmpHome: string,
  storeDbPath: string,
  wsStateFilePath: string,
  port = 3000,
): ResolvedConfig {
  return {
    format: 'json',
    quiet: true,
    debug: false,
    configFile: path.join(tmpHome, '.agent-remnote', 'config.json'),
    remnoteDb: undefined,
    storeDb: storeDbPath,
    wsUrl: 'ws://127.0.0.1:6789/ws',
    wsScheduler: true,
    wsDispatchMaxBytes: 512_000,
    wsDispatchMaxOpBytes: 256_000,
    repo: undefined,
    wsStateFile: { disabled: false, path: wsStateFilePath },
    wsStateStaleMs: 60_000,
    tmuxRefresh: false,
    tmuxRefreshMinIntervalMs: 250,
    statusLineFile: path.join(tmpHome, '.agent-remnote', 'status-line.txt'),
    statusLineMinIntervalMs: 250,
    statusLineDebug: false,
    statusLineJsonFile: path.join(tmpHome, '.agent-remnote', 'status-line.json'),
    apiBaseUrl: undefined,
    apiHost: '127.0.0.1',
    apiPort: port,
    apiBasePath: '/v1',
    apiPidFile: path.join(tmpHome, '.agent-remnote', 'api.pid'),
    apiLogFile: path.join(tmpHome, '.agent-remnote', 'api.log'),
    apiStateFile: path.join(tmpHome, '.agent-remnote', 'api.state.json'),
  };
}

export async function touchDbFile(dbPath: string): Promise<void> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(dbPath, '', 'utf8');
}

export async function writeWsState(
  wsStateFilePath: string,
  payload:
    | {
        readonly updatedAt: number;
        readonly clients: readonly unknown[];
        readonly activeWorkerConnId?: string | undefined;
        readonly [key: string]: unknown;
      }
    | undefined,
): Promise<void> {
  const normalized = os.platform() === 'win32' ? path.normalize(wsStateFilePath) : wsStateFilePath;
  await fs.mkdir(path.dirname(normalized), { recursive: true });
  await fs.writeFile(normalized, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}
