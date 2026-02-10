import { withResolvedDatabase } from "../packages/agent-remnote/src/internal/remdb-tools/shared.ts"
import { z } from "zod"

const argsSchema = z.object({
  query: z.string().default("2025/10/11"),
})

async function main() {
  const { query } = argsSchema.parse({ query: process.argv[2] })
  const { info, result } = await withResolvedDatabase(undefined, async (db) => {
    const likePattern = `%${query.toLowerCase().replace(/\s+/g, "%")}%`
    const rows = db
      .prepare(
        `SELECT _id, json_extract(doc,'$.key') AS key, json_extract(doc,'$.parent') AS parent
         FROM quanta WHERE lower(json_extract(doc,'$.key')) LIKE @pattern LIMIT 10`
      )
      .all({ pattern: likePattern }) as Array<{ _id: string; key: string; parent: string }>

    return { matches: rows }
  })

  console.log("Resolved DB:", info)
  console.log(JSON.stringify(result.matches, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
