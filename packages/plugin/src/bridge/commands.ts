import type { ReactRNPlugin } from '@remnote/plugin-sdk';

import { queryQueueStats } from './queue';
import { resolveClientInstanceId, resolveWsUrl } from './settings';
import { closeWorkerWs, runSyncLoop, startControlChannel, stopControlChannel } from './runtime';

export async function registerBridgeCommands(plugin: ReactRNPlugin) {
  try {
    await plugin.app.registerCommand({
      id: 'start-sync-ops',
      name: 'Start sync',
      action: async () => {
        const url = await resolveWsUrl(plugin);
        const clientInstanceId = await resolveClientInstanceId(plugin);
        try {
          await runSyncLoop(plugin, url, clientInstanceId, { silent: false });
        } catch (e: any) {
          await plugin.app.toast(`Failed to start sync: ${e?.message || e}`);
        }
      },
    });
  } catch {}

  try {
    await plugin.app.registerCommand({
      id: 'show-queue-stats',
      name: 'Show queue stats',
      action: async () => {
        const url = await resolveWsUrl(plugin);
        try {
          const stats = await queryQueueStats(url);
          await plugin.app.toast(`Pending: ${stats.pending} | In-flight: ${stats.in_flight} | Dead: ${stats.dead}`);
        } catch (e: any) {
          await plugin.app.toast(`Query failed: ${e?.message || e}`);
        }
      },
    });
  } catch {}

  try {
    await plugin.app.registerCommand({
      id: 'connect-control',
      name: 'Connect control channel',
      action: async () => {
        const url = await resolveWsUrl(plugin);
        const clientInstanceId = await resolveClientInstanceId(plugin);
        startControlChannel(plugin, url, clientInstanceId);
      },
    });
  } catch {}

  try {
    await plugin.app.registerCommand({
      id: 'disconnect-control',
      name: 'Disconnect control channel',
      action: async () => {
        try {
          stopControlChannel();
          closeWorkerWs();
          await plugin.app.toast('Control channel disconnected');
        } catch (e: any) {
          await plugin.app.toast(`Disconnect failed: ${e?.message || e}`);
        }
      },
    });
  } catch {}
}
