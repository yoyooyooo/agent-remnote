import type { ReactRNPlugin } from '@remnote/plugin-sdk';

import { registerAgentRemnotePowerups } from './powerups';
import { registerBridgeCommands } from './commands';
import { BRIDGE_SETTING_IDS, registerBridgeSettings, resolveClientInstanceId, resolveWsUrl } from './settings';
import {
  closeWorkerWs,
  registerSelectionForwarder,
  resetRuntimeState,
  registerUiContextForwarder,
  runSyncLoop,
  startControlChannel,
  stopControlChannel,
  unregisterSelectionForwarder,
  unregisterUiContextForwarder,
} from './runtime';

export async function onActivate(plugin: ReactRNPlugin) {
  // Avoid hard "early return" guards: RemNote may keep JS globals across plugin reload/update.
  // Make activation best-effort + idempotent to ensure new listeners (e.g. debug toasts) can take effect.
  try {
    resetRuntimeState();
  } catch {}
  try {
    const G: any = globalThis as any;
    G.__REMNOTE_BRIDGE_REGISTERED__ = true;
  } catch {}

  try {
    await registerBridgeSettings(plugin);
  } catch {}
  try {
    await registerAgentRemnotePowerups(plugin);
  } catch {}
  try {
    registerSelectionForwarder(plugin);
  } catch {}
  try {
    registerUiContextForwarder(plugin);
  } catch {}
  try {
    await registerBridgeCommands(plugin);
  } catch {}

  // Control channel: auto-connect based on settings.
  try {
    const auto = await plugin.settings.getSetting<boolean>(BRIDGE_SETTING_IDS.autoConnectControl);
    const autoSync = await plugin.settings.getSetting<boolean>(BRIDGE_SETTING_IDS.autoSyncOnConnect);
    const url = await resolveWsUrl(plugin);
    const clientInstanceId = await resolveClientInstanceId(plugin);
    if (auto) {
      startControlChannel(plugin, url, clientInstanceId);
    } else if (autoSync) {
      // If control channel is disabled but auto-sync is enabled, run a one-shot sync (with visible toast).
      try {
        await runSyncLoop(plugin, url, clientInstanceId, { silent: false });
      } catch {}
    }
  } catch {}
}

export async function onDeactivate(_: ReactRNPlugin) {
  try {
    unregisterSelectionForwarder(_);
  } catch {}
  try {
    unregisterUiContextForwarder(_);
  } catch {}
  resetRuntimeState();
  try {
    const G: any = globalThis as any;
    delete G.__REMNOTE_BRIDGE_REGISTERED__;
  } catch {}
}
