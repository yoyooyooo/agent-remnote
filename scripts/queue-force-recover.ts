import { openQueueDb } from "../packages/agent-remnote/src/internal/queue/db.ts"

async function main() {
  const db = openQueueDb()
  const t = Date.now()
  const inFlight = db.prepare(`SELECT op_id FROM queue_ops WHERE status='in_flight'`).all() as any[]
  const stmt = db.prepare(
    `UPDATE queue_ops SET status='pending', locked_by=NULL, locked_at=NULL, lease_expires_at=NULL, next_attempt_at=@t, updated_at=@t WHERE op_id=@op_id`,
  )
  const trx = db.transaction(() => {
    for (const r of inFlight) stmt.run({ t, op_id: r.op_id })
  })
  trx()
  console.log(JSON.stringify({ recovered: inFlight.length }, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
