#!/usr/bin/env bash
set -euo pipefail

# Output: "<bg>\t<value>" (single line) or nothing.
#
# States:
# - daemon down/off/stale: output nothing
# - daemon up, no clients: grey bg
# - daemon up, has client: warm bg

home="${HOME:-.}"
state_file="${REMNOTE_WS_STATE_FILE:-${WS_STATE_FILE:-$home/.agent-remnote/ws.bridge.state.json}}"
store_db="${REMNOTE_STORE_DB:-${STORE_DB:-$home/.agent-remnote/store.sqlite}}"
legacy_queue_db="${REMNOTE_QUEUE_DB:-${QUEUE_DB:-$home/.agent-remnote/queue.sqlite}}"
pid_file="${REMNOTE_DAEMON_PID_FILE:-${DAEMON_PID_FILE:-$home/.agent-remnote/ws.pid}}"
stale_ms="${REMNOTE_WS_STATE_STALE_MS:-${WS_STATE_STALE_MS:-60000}}"

bg_no_client="${TMUX_REMNOTE_BG_NO_CLIENT:-#4c566a}"
bg_connected="${TMUX_REMNOTE_BG_CONNECTED:-#d08770}"

to_int() {
  local v="${1:-}"
  if [[ -n "${v}" && "${v}" =~ ^[0-9]+$ ]]; then
    echo "${v}"
  else
    echo "0"
  fi
}

strip_newlines() {
  tr -d '\n'
}

read_pidfile_pid() {
  local pid="0"
  if [[ -f "${pid_file}" ]]; then
    if command -v jq >/dev/null 2>&1; then
      pid="$(jq -r '.pid // 0' "${pid_file}" 2>/dev/null | strip_newlines || true)"
    else
      pid="$(tr -d '\n' <"${pid_file}" 2>/dev/null | sed -n 's/.*\"pid\"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' || true)"
    fi
  fi
  to_int "${pid}"
}

read_pidfile_ws_state_file() {
  local p=""
  if [[ -f "${pid_file}" ]]; then
    if command -v jq >/dev/null 2>&1; then
      p="$(jq -r '.ws_bridge_state_file // empty' "${pid_file}" 2>/dev/null | strip_newlines || true)"
    else
      p="$(
        tr -d '\n' <"${pid_file}" 2>/dev/null \
          | sed -n 's/.*\"ws_bridge_state_file\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p' \
          || true
      )"
    fi
  fi
  printf '%s' "${p}"
}

queue_outstanding() {
  # Prefer the daemon-provided queue snapshot from the bridge state file (avoids store-db mismatch).
  if command -v jq >/dev/null 2>&1 && [[ -f "${state_file}" ]]; then
    local q_state
    q_state="$(
      jq -r '
        if ((.queue.stats // null) | type) == "object" then
          ((.queue.stats.pending // 0) + (.queue.stats.in_flight // .queue.stats.in_progress // 0))
        else
          empty
        end
      ' "${state_file}" 2>/dev/null | strip_newlines || true
    )"
    if [[ -n "${q_state}" ]]; then
      q_state="$(to_int "${q_state}")"
      echo "${q_state}"
      return 0
    fi
  fi

  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "0"
    return 0
  fi

  local db_path="${store_db}"
  if [[ -z "${REMNOTE_STORE_DB:-}" && -z "${STORE_DB:-}" ]]; then
    if [[ ! -f "${db_path}" && -f "${legacy_queue_db}" ]]; then
      db_path="${legacy_queue_db}"
    fi
  fi

  if [[ ! -f "${db_path}" ]]; then
    echo "0"
    return 0
  fi
  local q
  q="$(
    sqlite3 "${db_path}" "
      SELECT
        CASE
          WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='queue_ops')
            THEN (SELECT count(*) FROM queue_ops WHERE status IN ('pending','in_flight'))
          WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='ops')
            THEN (SELECT count(*) FROM ops WHERE status IN ('pending','in_flight'))
          ELSE 0
        END;
    " 2>/dev/null | strip_newlines || true
  )"
  to_int "${q}"
}

# Pid gate: if pidfile exists and pid is not alive, hide the segment.
pid="$(read_pidfile_pid)"
if (( pid > 0 )); then
  if ! kill -0 "${pid}" 2>/dev/null; then
    exit 0
  fi
fi

# If no state_file override is present, try to use the path recorded by the daemon pidfile.
if [[ -z "${REMNOTE_WS_STATE_FILE:-}" && -z "${WS_STATE_FILE:-}" ]]; then
  pid_state_file="$(read_pidfile_ws_state_file)"
  if [[ -n "${pid_state_file}" ]]; then
    state_file="${pid_state_file}"
  fi
fi

if command -v jq >/dev/null 2>&1 && [[ -f "${state_file}" ]]; then
  updated_at_ms="$(jq -r '.updatedAt // 0' "${state_file}" 2>/dev/null | strip_newlines || true)"
  updated_at_ms="$(to_int "${updated_at_ms}")"
  if (( updated_at_ms > 0 )); then
    now_s="$(date +%s)"
    updated_s=$(( updated_at_ms / 1000 ))
    stale_s=$(( $(to_int "${stale_ms}") / 1000 ))
    (( stale_s < 1 )) && stale_s=1

    if (( now_s - updated_s <= stale_s )); then
      line="$(
        jq -r '
          (.clients // []) as $cs |
          ($cs | length) as $nClients |
          .activeWorkerConnId as $id |
          (( $cs | map(select(.connId==$id)) | .[0]) //
           ( $cs | map(select(.isActiveWorker==true)) | .[0]) //
           ( $cs | .[0]) // empty) as $c |
          if ($c|type) != "object" then
            "\($nClients)\t\t"
          else
            ($c.selection.kind // "none") as $k |
            (if $k == "rem" then ($c.selection.totalCount // $c.selection.count // 0) else 0 end) as $selCount |
            "\($nClients)\t\($k)\t\($selCount)"
          end
        ' "${state_file}" 2>/dev/null || true
      )"
      line="${line//$'\n'/}"

      clients="${line%%$'\t'*}"
      clients="$(to_int "${clients}")"
      rest="${line#*$'\t'}"
      kind="${rest%%$'\t'*}"
      count="${rest#*$'\t'}"
      count="$(to_int "${count}")"

      base="RN"
      bg="${bg_no_client}"
      if (( clients > 0 )); then
        bg="${bg_connected}"
        if [[ "${kind}" == "text" ]]; then
          base="TXT"
        elif [[ "${kind}" == "rem" ]] && (( count > 0 )); then
          base="${count} rems"
        fi
      fi

      q="$(queue_outstanding)"
      if (( q > 0 )); then
        printf '%s\t%s ↓%s' "${bg}" "${base}" "${q}"
      else
        printf '%s\t%s' "${bg}" "${base}"
      fi
      exit 0
    fi
  fi
fi

# Fallback: heavy CLI (best-effort). This path doesn't distinguish "no client" vs "connected".
remnote_cli="${REMNOTE_CLI:-$home/.local/bin/agent-remnote}"
if [[ -x "${remnote_cli}" ]]; then
  value="$("${remnote_cli}" daemon status-line 2>/dev/null | strip_newlines || true)"
  if [[ -n "${value}" ]]; then
    printf '%s\t%s' "${bg_connected}" "${value}"
  fi
fi
