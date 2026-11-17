# RemNote agent guidance ownership

The reusable `remnote` Skill is maintained in Notion at
[`skill://41b5636c-236e-81a7-9619-f91a83e4164a/SKILL.md`](https://www.notion.so/41b5636c236e81a79619f91a83e4164a).
Agent Kit's former project copy at `skills/remnote` is retired. Do not recreate
that directory or use a historical evaluation snapshot as its replacement.

The project contracts in `docs/ssot/agent-remnote` remain authoritative for CLI,
queue, plugin, runtime and parity semantics. The Skill routes agents to those
contracts and contains progressively loaded supporting documents. Its content
is read through the formal `ntn-skills` CLI, including all files required by a
task. The migration receipt in `docs/skill-handoffs/remnote.json` records the exact
owner, verified normal-consumer snapshot and full file hashes; it contains no
replacement Skill instructions.

## Verification

Repository contract tests continue to check repository documentation and the
handoff receipt without accessing Notion. The four external guidance checks are
explicitly skipped unless `AGENT_REMNOTE_SKILL_EXPORT_DIR` is supplied. A skipped
external check is not evidence that current Notion content was consumed.

For a complete guidance check, use the official CLI to export the receipt's
fixed snapshot into a temporary directory outside any Skill discovery root.
Set `AGENT_REMNOTE_SKILL_EXPORT_DIR` to that absolute directory, then run the four
contract files `remnote-docs-drift`, `skill-scenario-drift`,
`scenario-promotion-preconditions` and `scenario-doc-propagation` with Vitest.
The checks require the entire recorded tree and the CLI's exact
`.ntn-skills.json` export metadata. They verify every file's hash, size and
executable mode, and inspect all Markdown documents so progressive disclosure
does not falsely require every authority link in `SKILL.md` itself.

A later Notion change requires a new complete normal-consumer observation and
an updated receipt before these checks can certify that new snapshot. Never
fill the receipt from a local working copy or an authoring-only read. No check
starts RemNote, writes to its official database, or invokes a business command.
