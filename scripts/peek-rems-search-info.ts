import { withResolvedDatabase } from "../packages/agent-remnote/src/internal/remdb-tools/shared.ts";

async function main() {
  const id = (process.argv[2] || '').trim();
  if (!id) {
    console.error('Usage: tsx scripts/peek-rems-search-info.ts <remId>');
    process.exit(1);
  }
  const { result } = await withResolvedDatabase(undefined, async (db) => {
    const row = db.prepare(`SELECT id, aliasId, json_type(doc) as docType, doc, ancestor_not_ref_text, ancestor_ids FROM remsSearchInfos WHERE id = @id`).get({ id });
    return row ?? null;
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
