export { startWebSocketBridge } from './ws-bridge/index.js';

export type { StoreDB } from './store/index.js';
export { StoreSchemaError, defaultLegacyQueuePath, defaultStorePath, openStoreDb } from './store/index.js';

export { QueueSchemaError, openQueueDb } from './queue/index.js';
export { enqueueTxn, getTxnIdByOpId, queueConflicts, queueStats } from './queue/index.js';

export type { BackupInfo, BetterSqliteInstance, DbResolution, SearchRemOverviewInput } from './remdb-tools/index.js';
export {
  TYPES,
  discoverBackups,
  executeFindRemsByReference,
  executeGetRemConnections,
  executeInspectRemDoc,
  executeListRemBackups,
  executeListRemReferences,
  executeListTodos,
  executeOutlineRemSubtree,
  executeReadRemTable,
  executeResolveRemPage,
  executeResolveRemReference,
  executeSearchQuery,
  executeSearchRemOverview,
  executeSummarizeDailyNotes,
  executeSummarizeTopicActivity,
  formatDateWithPattern,
  getDateFormatting,
  withResolvedDatabase,
} from './remdb-tools/index.js';
