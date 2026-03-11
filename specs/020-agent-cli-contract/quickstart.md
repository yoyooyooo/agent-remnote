# Quickstart: 020-agent-cli-contract

## Goal

Validate the canonical write contract and the new direct-children wrapper surface end to end.

## 1. Structured apply through CLI

```bash
agent-remnote apply --payload @./specs/020-agent-cli-contract/examples/apply-actions.json
```

Expected:

- returns one JSON envelope
- write is routed through the canonical apply contract

## 2. Replace direct children via wrapper command

```bash
agent-remnote rem children replace --rem <rid> --markdown - <<'MD'
- topic
  - point
MD
```

Expected:

- target Rem remains
- direct children are replaced

## 3. Append direct children from file

```bash
agent-remnote rem children append --rem <rid> --markdown @./note.md
```

## 4. Clear direct children only

```bash
agent-remnote rem children clear --rem <rid>
```

Expected:

- target Rem still exists
- direct children are removed

## 5. Daily write with unified Markdown input

```bash
agent-remnote daily write --markdown $'- journal\n  - item'
```

## 6. Structured apply through Host API

```bash
curl -X POST http://127.0.0.1:3000/v1/write/apply \
  -H 'content-type: application/json' \
  -d @./specs/020-agent-cli-contract/examples/apply-actions.json
```

## 7. Remote mode through wrapper command

```bash
agent-remnote --api-base-url http://127.0.0.1:3000 \
  rem children prepend --rem <rid> --markdown $'- remote\n  - write'
```

## 8. Removed commands fail fast

```bash
agent-remnote import markdown --ref "page:Inbox" --markdown "- should fail"
agent-remnote plan apply --payload '{}'
```

Expected:

- both invocations fail fast
- no compatibility redirection occurs
