export type { QueueDB } from './db.js';
export { QueueSchemaError, defaultQueuePath, ensureDir, openQueueDb } from './db.js';

export type { AckResult, BatchClaimCandidate, EnqueueOpInput, LeaseExtendResult, OpRow, OpType } from './dao.js';
export {
  IdMapConflictError,
  ackDead,
  ackRetry,
  ackSuccess,
  claimOpById,
  claimSelectedOpsBatch,
  claimNextOp,
  extendLease,
  enqueueTxn,
  getTxnIdByOpId,
  getRemoteIdsByClientTempIds,
  listInFlightOps,
  peekEligibleOps,
  queueConflicts,
  queueStats,
  recordOpAttempt,
  recoverExpiredLeases,
  upsertIdMap,
} from './dao.js';
