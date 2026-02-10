import type { ReactRNPlugin } from '@remnote/plugin-sdk';

export const BRIDGE_SETTING_IDS = {
  wsPort: 'ws-port',
  autoConnectControl: 'auto-connect-control',
  autoSyncOnConnect: 'auto-sync-on-connect',
  syncConcurrency: 'sync-concurrency',
} as const;

export const DEFAULT_WS_PORT = 6789;

function normalizeWsPort(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  const port = Math.trunc(value);
  if (port < 1 || port > 65535) return null;
  return port;
}

function buildLocalWsUrl(port: number): string {
  return `ws://localhost:${port}/ws`;
}

export async function resolveWsUrl(plugin: ReactRNPlugin): Promise<string> {
  let portRaw: unknown = null;
  try {
    portRaw = await plugin.settings.getSetting<number>(BRIDGE_SETTING_IDS.wsPort);
  } catch {}
  const port = normalizeWsPort(portRaw) ?? DEFAULT_WS_PORT;
  return buildLocalWsUrl(port);
}

const clientInstanceIdKey = 'agent-remnote.client-instance-id';

function newClientInstanceId(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {}
  const rand = Math.random().toString(36).slice(2, 12);
  const ts = Date.now().toString(36);
  return `client-${ts}-${rand}`;
}

export async function resolveClientInstanceId(plugin: ReactRNPlugin): Promise<string> {
  try {
    const existing = await plugin.storage.getLocal<string>(clientInstanceIdKey);
    if (typeof existing === 'string' && existing.trim()) return existing.trim();
  } catch {}
  const created = newClientInstanceId();
  try {
    await plugin.storage.setLocal(clientInstanceIdKey, created);
  } catch {}
  return created;
}

export async function registerBridgeSettings(plugin: ReactRNPlugin) {
  try {
    await plugin.settings.registerNumberSetting({
      id: BRIDGE_SETTING_IDS.wsPort,
      title: 'WebSocket Port',
      defaultValue: DEFAULT_WS_PORT,
    });
  } catch {}
  try {
    await plugin.settings.registerBooleanSetting({
      id: BRIDGE_SETTING_IDS.autoConnectControl,
      title: 'Auto-connect control channel',
      defaultValue: true,
    });
  } catch {}
  try {
    await plugin.settings.registerBooleanSetting({
      id: BRIDGE_SETTING_IDS.autoSyncOnConnect,
      title: 'Auto-sync on connect',
      defaultValue: true,
    });
  } catch {}
  try {
    await plugin.settings.registerNumberSetting({
      id: BRIDGE_SETTING_IDS.syncConcurrency,
      title: 'Sync concurrency',
      defaultValue: 4,
    });
  } catch {}
}
