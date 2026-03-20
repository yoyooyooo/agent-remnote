export { startWebSocketBridge } from './ws-bridge/index.js';

export type { StoreDB } from './store/index.js';
export {
  StoreSchemaError,
  defaultLegacyQueuePath,
  defaultStorePath,
  getTaskRunById,
  insertEventRecord,
  listBackupArtifacts,
  openStoreDb,
  upsertTaskDefinition,
  upsertTaskRun,
  upsertTriggerRule,
  updateBackupArtifactsCleanupState,
  upsertBackupArtifact,
} from './store/index.js';
export type { BackupArtifactRow, BackupKind, CleanupPolicy, CleanupState } from './store/index.js';

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
  executeSummarizeRecentActivity,
  executeSummarizeTopicActivity,
  formatDateWithPattern,
  getDateFormatting,
  withResolvedDatabase,
} from './remdb-tools/index.js';
