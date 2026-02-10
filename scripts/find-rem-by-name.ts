import { withResolvedDatabase } from "../packages/agent-remnote/src/internal/remdb-tools/shared.ts"

async function main() {
  const name = (process.argv[2] || '').trim()
  if (!name) {
    console.error('Usage: tsx scripts/find-rem-by-name.ts <name>')
    process.exit(1)
  }
  const q = name.toLowerCase()
  const { result } = await withResolvedDatabase(undefined, async (db) => {
    const stmt = db.prepare(
      `SELECT id, json_extract(doc,'$.kt') AS kt
       FROM remsSearchInfos
       WHERE lower(json_extract(doc,'$.kt')) = @q
       LIMIT 20`
    )
    const exact = stmt.all({ q }) as Array<{ id: string; kt: string }>
    if (exact.length > 0) return { exact, fuzzy: [] }
    const fuzzy = db.prepare(
      `SELECT id, json_extract(doc,'$.kt') AS kt
       FROM remsSearchInfos
       WHERE lower(json_extract(doc,'$.kt')) LIKE @p
       LIMIT 20`
    ).all({ p: `%${q}%` }) as Array<{ id: string; kt: string }>
    return { exact: [], fuzzy }
  })
  console.log(JSON.stringify(result, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
