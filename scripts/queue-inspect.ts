import { openQueueDb } from "../packages/agent-remnote/src/internal/queue/db.ts"

function safeParse(s: string) { try { return JSON.parse(s) } catch { return null } }

async function main() {
  const db = openQueueDb()
  const arg = process.argv[2]
  if (!arg) {
    console.error("Usage: tsx scripts/queue-inspect.ts <txn_id|op_id>")
    process.exit(1)
  }
  let txn_id = arg
  if (!/^[0-9a-fA-F-]{8,}$/.test(arg)) {
    console.error("invalid id format")
  }
  // try resolve by op_id first
  const byOp = db.prepare(`SELECT txn_id FROM queue_ops WHERE op_id=?`).get(arg) as any
  if (byOp?.txn_id) txn_id = byOp.txn_id

  const txn = db.prepare(`SELECT * FROM queue_txns WHERE txn_id=?`).get(txn_id) as any
  if (!txn) throw new Error(`txn not found: ${txn_id}`)
  const ops = db.prepare(`SELECT * FROM queue_ops WHERE txn_id=? ORDER BY op_seq ASC`).all(txn_id) as any[]
  const resultRows = db
    .prepare(`SELECT * FROM queue_op_results WHERE op_id IN (${ops.map(() => '?').join(',') || "''"})`)
    .all(...ops.map(o => o.op_id)) as any[]
  const resMap = new Map<string, any>()
  for (const r of resultRows) resMap.set(r.op_id, r)
  const idMap = db.prepare(`SELECT * FROM queue_id_map WHERE source_txn=?`).all(txn_id) as any[]

  const detail = ops.map((o) => ({
    op_id: o.op_id,
    seq: o.op_seq,
    type: o.type,
    status: o.status,
    attempts: o.attempt_count,
    next_attempt_at: o.next_attempt_at,
    payload: safeParse(o.payload_json),
    result: resMap.get(o.op_id) || null,
  }))

  console.log(JSON.stringify({ txn, ops: detail, id_map: idMap }, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
