#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "## agent-remnote integration test 002 supervisor"
echo "started_at=$(date -Iseconds)"

npm run build --workspace agent-remnote >/dev/null

PORT="$(
  node -e 'const net=require("net");const s=net.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close();});'
)"
WSURL="ws://127.0.0.1:${PORT}/ws"

TMPDIR="$(mktemp -d)"
export HOME="$TMPDIR"

PIDFILE="$TMPDIR/ws.pid"
LOGFILE="$TMPDIR/ws.log"
STATEFILE="$TMPDIR/ws.state.json"
STOREDB="$TMPDIR/store.sqlite"

echo "tmpdir=$TMPDIR"
echo "wsurl=$WSURL"

stop_if_running() {
  set +e
  if [ -f "$PIDFILE" ]; then
    timeout 10s node packages/agent-remnote/cli.js --json daemon stop --force --pid-file "$PIDFILE" >/dev/null 2>&1 || true
  fi
}
trap stop_if_running EXIT

echo "-- start supervisor"
set +e
START_JSON="$(
  timeout 20s node packages/agent-remnote/cli.js --json --daemon-url "$WSURL" --store-db "$STOREDB" daemon start --wait 5000 --pid-file "$PIDFILE" --log-file "$LOGFILE"
)"
START_CODE=$?
set -e
echo "$START_JSON"
echo "start_exit_code=$START_CODE"
echo "$START_JSON" | node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(0,"utf8")); if(!j.ok) process.exit(2);'

for _ in $(seq 1 60); do
  CHILD_PID="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(p.child_pid||"");' "$PIDFILE" 2>/dev/null || true)"
  if [ -n "$CHILD_PID" ]; then break; fi
  sleep 0.1
done

SUPERVISOR_PID="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(p.pid);' "$PIDFILE")"
CHILD_PID="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(p.child_pid);' "$PIDFILE")"

echo "supervisor_pid=$SUPERVISOR_PID"
echo "child_pid=$CHILD_PID"

echo "-- status should show supervisor+child running and ws healthy"
STATUS_JSON="$(timeout 20s node packages/agent-remnote/cli.js --json --daemon-url "$WSURL" daemon status --pid-file "$PIDFILE")"
echo "$STATUS_JSON"
echo "$STATUS_JSON" | node -e '
  const fs=require("fs");
  const j=JSON.parse(fs.readFileSync(0,"utf8"));
  if(!j.ok) process.exit(2);
  if(j.data.service.mode!=="supervisor") process.exit(3);
  if(!j.data.service.supervisor.running) process.exit(4);
  if(!j.data.service.child.running) process.exit(5);
  if(!j.data.ws.healthy) process.exit(6);
'

echo "-- kill child and expect restart"
kill -9 "$CHILD_PID"

OLD_CHILD="$CHILD_PID"
for _ in $(seq 1 120); do
  NEW_CHILD="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(p.child_pid||"");' "$PIDFILE" 2>/dev/null || true)"
  RC="$(node -e 'const fs=require("fs");try{const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(s.restart_count??"");}catch{console.log("");}' "$STATEFILE" 2>/dev/null || true)"
  if [ -n "$NEW_CHILD" ] && [ "$NEW_CHILD" != "$OLD_CHILD" ] && [ -n "$RC" ] && [ "$RC" -ge 1 ]; then
    echo "restarted: old_child=$OLD_CHILD new_child=$NEW_CHILD restart_count=$RC"
    break
  fi
  sleep 0.2
done

NEW_CHILD="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(p.child_pid||"");' "$PIDFILE" 2>/dev/null || true)"
if [ -z "$NEW_CHILD" ] || [ "$NEW_CHILD" = "$OLD_CHILD" ]; then
  echo "ERROR: child did not restart"
  exit 10
fi

echo "-- stop"
STOP_JSON="$(timeout 20s node packages/agent-remnote/cli.js --json daemon stop --force --pid-file "$PIDFILE")"
echo "$STOP_JSON"
echo "$STOP_JSON" | node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(0,"utf8")); if(!j.ok) process.exit(2);'

if [ -f "$PIDFILE" ]; then echo "ERROR: pidfile still exists"; exit 11; fi
if [ -f "$STATEFILE" ]; then echo "ERROR: statefile still exists"; exit 12; fi

node -e 'try{process.kill(Number(process.argv[1]),0); process.exit(13);}catch{process.exit(0);}' "$SUPERVISOR_PID"
node -e 'try{process.kill(Number(process.argv[1]),0); process.exit(14);}catch{process.exit(0);}' "$NEW_CHILD"

echo "RESULT=PASS"
echo "tmpdir_kept=$TMPDIR"
