import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { homeDir } from './paths.js';

export type RemnoteLink = {
  readonly workspaceId: string;
  readonly remId: string;
};

export function tryParseRemnoteLink(input: string): RemnoteLink | undefined {
  const raw = input.trim();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }

  // Desktop deep link: remnote://w/<workspaceId>/<remId>
  if (u.protocol === 'remnote:' && u.hostname === 'w') {
    const parts = u.pathname.split('/').filter(Boolean);
    const workspaceId = parts.length >= 1 ? parts[0] : undefined;
    const remId = parts.length >= 2 ? parts[1] : undefined;
    if (workspaceId && remId) {
      return { workspaceId: workspaceId.trim(), remId: remId.trim() };
    }
    return undefined;
  }

  // Web URL: https://www.remnote.com/w/<workspaceId>/<remId>
  if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.endsWith('remnote.com')) {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 3 && parts[0] === 'w') {
      const workspaceId = parts[1];
      const remId = parts[2];
      if (workspaceId && remId) {
        return { workspaceId: workspaceId.trim(), remId: remId.trim() };
      }
    }
  }

  return undefined;
}

export function tryParseRemnoteLinkFromRef(input: string): RemnoteLink | undefined {
  const direct = tryParseRemnoteLink(input);
  if (direct) return direct;

  const raw = input.trim();
  const idx = raw.indexOf(':');
  if (idx <= 0) return undefined;
  const value = raw.slice(idx + 1).trim();
  if (!value) return undefined;
  return tryParseRemnoteLink(value);
}

export function remnoteDbPathForWorkspaceId(workspaceId: string): string {
  return path.join(homeDir(), 'remnote', `remnote-${workspaceId}`, 'remnote.db');
}

export async function tryResolveRemnoteDbPathForWorkspaceId(workspaceId: string): Promise<string | undefined> {
  const p = remnoteDbPathForWorkspaceId(workspaceId);
  try {
    const stat = await fsp.stat(p);
    return stat.isFile() ? p : undefined;
  } catch {
    return undefined;
  }
}

export function tryResolveRemnoteDbPathForWorkspaceIdSync(workspaceId: string): string | undefined {
  const p = remnoteDbPathForWorkspaceId(workspaceId);
  try {
    return fs.statSync(p).isFile() ? p : undefined;
  } catch {
    return undefined;
  }
}
