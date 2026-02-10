import WebSocket from "ws"

type HealthcheckResult =
  | { ok: true; url: string; rtt_ms: number }
  | { ok: false; url: string; error: string }

function formatError(e: unknown): string {
  if (!e) return "unknown error"
  if (typeof e === "string") return e
  const anyErr = e as any
  if (anyErr?.errors && Array.isArray(anyErr.errors)) {
    const parts = anyErr.errors
      .map((inner: any) => {
        const code = inner?.code ? String(inner.code) : ""
        const msg = inner?.message ? String(inner.message) : String(inner)
        return code ? `${code}: ${msg}` : msg
      })
      .filter(Boolean)
    if (parts.length > 0) return `AggregateError(${parts.join("; ")})`
  }
  if (typeof anyErr?.message === "string") return anyErr.message
  return String(e)
}

function parseTimeoutMs(raw: unknown, fallback: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

async function healthcheckWsBridge(url: string, timeoutMs: number): Promise<HealthcheckResult> {
  const startedAt = Date.now()

  return await new Promise<HealthcheckResult>((resolve) => {
    const ws = new WebSocket(url)

    let done = false
    const finish = (result: HealthcheckResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        ws.terminate()
      } catch {}
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({ ok: false, url, error: `timeout after ${timeoutMs}ms` })
    }, timeoutMs)

    ws.on("open", () => {
      try {
        ws.send(JSON.stringify({ type: "Hello" }))
      } catch (e: any) {
        finish({ ok: false, url, error: String(e?.message || e || "failed to send Hello") })
      }
    })

    ws.on("message", (data) => {
      let msg: any
      try {
        msg = JSON.parse(String(data))
      } catch {
        return
      }
      if (msg?.type === "HelloAck" && msg?.ok === true) {
        finish({ ok: true, url, rtt_ms: Date.now() - startedAt })
      }
    })

    ws.on("error", (e: any) => {
      finish({ ok: false, url, error: formatError(e) })
    })

    ws.on("close", () => {
      // Connection closed unexpectedly before receiving HelloAck
      finish({ ok: false, url, error: "connection closed" })
    })
  })
}

async function main() {
  const portRaw = process.env.REMNOTE_WS_PORT || process.env.WS_PORT;
  const port = portRaw ? Number(portRaw) : NaN;
  const resolvedPort = Number.isFinite(port) && port > 0 ? Math.floor(port) : 6789;
  const url =
    process.argv[2] ||
    process.env.REMNOTE_DAEMON_URL ||
    process.env.DAEMON_URL ||
    `ws://localhost:${resolvedPort}/ws`;
  const timeoutMs = parseTimeoutMs(process.argv[3] || process.env.WS_TIMEOUT_MS, 2000)
  const asJson = process.env.PRINT_JSON === "1" || process.argv.includes("--json")

  const result = await healthcheckWsBridge(url, timeoutMs)
  if (asJson) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    if (result.ok) console.log(`OK daemon: ${result.url} (rtt ${result.rtt_ms}ms)`)
    else console.log(`FAIL daemon: ${result.url} (${result.error})`)
  }
  process.exit(result.ok ? 0 : 1)
}

main().catch((e) => {
  console.error(String((e as any)?.message || e))
  process.exit(1)
})
