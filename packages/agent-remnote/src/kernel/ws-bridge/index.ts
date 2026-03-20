export type {
  WsBridgeClient,
  WsBridgeKickConfig,
  WsBridgeKickSnapshot,
  WsBridgeServerInfo,
  WsBridgeStateFileSnapshot,
  WsClientCapabilities,
  WsClientSelection,
  WsClientUiContext,
  WsRuntimeInfo,
  WsConnId,
} from './model.js';

export type { WsBridgeElectionParams } from './election.js';
export { activityAt, electActiveWorker } from './election.js';

export { normalizeSelectionForUiContext } from './selection.js';
