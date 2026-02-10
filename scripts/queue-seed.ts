import { openQueueDb } from "../packages/agent-remnote/src/internal/queue/db.ts"
import { enqueueTxn } from "../packages/agent-remnote/src/internal/queue/dao.ts"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('ws') as typeof import('ws')

async function main() {
  const db = openQueueDb()
  const type = (process.argv[2] as any) || "create_rem"
  const payloadRaw = process.argv[3]
  const payload = payloadRaw ? JSON.parse(payloadRaw) : { parent_id: "ROOT", text: ["Hello from queue"] }
  const txn = enqueueTxn(db, [ { type, payload } ])
  console.log("enqueued txn:", txn)

  // Optional: trigger StartSync broadcast via WS (requires TriggerStartSync support on the server)
  const shouldNotify = process.env.WS_NOTIFY === '1' || process.argv.includes('notify')
  if (shouldNotify) {
    const portRaw = process.env.REMNOTE_WS_PORT || process.env.WS_PORT;
    const port = portRaw ? Number(portRaw) : NaN;
    const resolvedPort = Number.isFinite(port) && port > 0 ? Math.floor(port) : 6789;
    const url = process.env.REMNOTE_DAEMON_URL || process.env.DAEMON_URL || `ws://localhost:${resolvedPort}/ws`;
    try {
      await notifyStartSync(url)
      console.log("notified via WS TriggerStartSync")
    } catch (e) {
      console.error("notify failed:", (e as any)?.message || e)
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })

async function notifyStartSync(url: string) {
  const ws = new WebSocket(url)
  await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', (e: any) => reject(e)) })
  ws.send(JSON.stringify({ type: 'TriggerStartSync' }))
  await new Promise<void>((resolve) => setTimeout(resolve, 100))
  ws.close()
}
