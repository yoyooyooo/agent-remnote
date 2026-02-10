import fs from 'node:fs';
import path from 'node:path';

import { homeDir, resolveUserFilePath } from './paths.js';

export type WsLogLevel = 'debug' | 'info' | 'warn' | 'error';

function envDebug(): boolean {
  const v = (process.env.REMNOTE_WS_DEBUG || process.env.WS_DEBUG || '').toLowerCase();
  return v === '1' || v === 'true';
}

function envLogFilePath(params: { readonly debug: boolean }): string | undefined {
  const p = process.env.REMNOTE_WS_LOGFILE || process.env.WS_LOGFILE || '';
  const def = params.debug ? path.join(homeDir(), '.agent-remnote', 'ws-debug.log') : '';
  const out = (p && p.trim()) || def;
  if (!out) return undefined;

  try {
    const resolved = resolveUserFilePath(out);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    return resolved;
  } catch {
    return undefined;
  }
}

const DEBUG = envDebug();
const LOG_FILE = envLogFilePath({ debug: DEBUG });

function safeStringify(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function wsLog(level: WsLogLevel, msg: string, ctx?: unknown): void {
  if (level === 'debug' && !DEBUG) return;

  const prefix = `[ws] ${level.toUpperCase()} ${msg}`;
  const ctxStr = ctx ? safeStringify(ctx) : '';
  const line = ctxStr ? `${prefix} ${ctxStr}` : prefix;

  try {
    if (level === 'warn' || level === 'error') console.error(line);
    else console.log(line);
  } catch {}

  if (!LOG_FILE) return;
  try {
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

