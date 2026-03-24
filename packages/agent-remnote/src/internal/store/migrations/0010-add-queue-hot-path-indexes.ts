import type { StoreDB } from '../db.js';

const IDX_OPS_TXN_STATUS_SEQ_SQL =
  `CREATE INDEX IF NOT EXISTS idx_ops_txn_status_seq ON queue_ops(txn_id, status, op_seq);`;
const IDX_OPS_STATUS_NEXT_TXN_SQL =
  `CREATE INDEX IF NOT EXISTS idx_ops_status_next_txn ON queue_ops(status, next_attempt_at, txn_id);`;
const IDX_OP_DEPS_OP_ID_SQL =
  `CREATE INDEX IF NOT EXISTS idx_op_deps_op_id ON queue_op_dependencies(op_id);`;
const IDX_TXNS_STATUS_PRIORITY_SQL =
  `CREATE INDEX IF NOT EXISTS idx_txns_status_priority ON queue_txns(status, priority, txn_id);`;

export const migration = {
  version: 10,
  name: 'add_queue_hot_path_indexes',
  checksumInput: [
    IDX_OPS_TXN_STATUS_SEQ_SQL,
    IDX_OPS_STATUS_NEXT_TXN_SQL,
    IDX_OP_DEPS_OP_ID_SQL,
    IDX_TXNS_STATUS_PRIORITY_SQL,
  ].join('\n'),
  apply: (db: StoreDB) => {
    db.exec(IDX_OPS_TXN_STATUS_SEQ_SQL);
    db.exec(IDX_OPS_STATUS_NEXT_TXN_SQL);
    db.exec(IDX_OP_DEPS_OP_ID_SQL);
    db.exec(IDX_TXNS_STATUS_PRIORITY_SQL);
  },
} as const;
