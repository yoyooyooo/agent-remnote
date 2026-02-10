import { expandHome as _expandHome } from '../../lib/paths.js';
import {
  defaultStateFilePath as wsDefaultStateFilePath,
  resolveStateFilePath as wsResolveStateFilePath,
  readJson as wsReadJson,
  pickClient as wsPickClient,
  resolveStaleMs as wsResolveStaleMs,
} from '../../lib/wsState.js';

export function expandHome(targetPath: string): string {
  return _expandHome(targetPath);
}

export function defaultStateFilePath(): string {
  return wsDefaultStateFilePath();
}

export function resolveStateFilePath(explicit?: string): { readonly disabled: boolean; readonly path: string } {
  return wsResolveStateFilePath(explicit);
}

export function readJson(filePath: string): any | null {
  return wsReadJson(filePath);
}

export function pickClient(clients: any[], connId?: string | undefined) {
  return wsPickClient(clients, connId);
}

export function resolveStaleMs(explicit?: number): number {
  return wsResolveStaleMs(explicit);
}
