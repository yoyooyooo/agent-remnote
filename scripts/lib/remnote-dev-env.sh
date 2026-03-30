# shellcheck shell=bash
REMNOTE_DEV_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMNOTE_DEV_SCRIPTS_DIR="$(cd "$REMNOTE_DEV_LIB_DIR/.." && pwd)"
REMNOTE_DEV_REPO_ROOT="$(cd "$REMNOTE_DEV_SCRIPTS_DIR/.." && pwd)"

home_dir="${HOME:-.}"
remnote_dev_default_root="${AGENT_REMNOTE_DEV_ROOT:-$home_dir/.agent-remnote-dev-main}"
mkdir -p "$remnote_dev_default_root"

export AGENT_REMNOTE_REPO="${AGENT_REMNOTE_REPO:-$REMNOTE_DEV_REPO_ROOT}"
export REMNOTE_CONFIG_FILE="${REMNOTE_CONFIG_FILE:-$remnote_dev_default_root/config.json}"
export REMNOTE_STORE_DB="${REMNOTE_STORE_DB:-$remnote_dev_default_root/store.sqlite}"
export REMNOTE_WS_PORT="${REMNOTE_WS_PORT:-16789}"
export REMNOTE_API_HOST="${REMNOTE_API_HOST:-127.0.0.1}"
export REMNOTE_API_PORT="${REMNOTE_API_PORT:-13000}"
export REMNOTE_PLUGIN_SERVER_PORT="${REMNOTE_PLUGIN_SERVER_PORT:-18080}"
export REMNOTE_WS_STATE_FILE="${REMNOTE_WS_STATE_FILE:-$remnote_dev_default_root/ws.bridge.state.json}"
export REMNOTE_STATUS_LINE_FILE="${REMNOTE_STATUS_LINE_FILE:-$remnote_dev_default_root/status-line.txt}"
export REMNOTE_STATUS_LINE_JSON_FILE="${REMNOTE_STATUS_LINE_JSON_FILE:-$remnote_dev_default_root/status-line.json}"
export REMNOTE_DAEMON_PID_FILE="${REMNOTE_DAEMON_PID_FILE:-$remnote_dev_default_root/ws.pid}"
export REMNOTE_DAEMON_LOG_FILE="${REMNOTE_DAEMON_LOG_FILE:-$remnote_dev_default_root/ws.log}"
export REMNOTE_API_PID_FILE="${REMNOTE_API_PID_FILE:-$remnote_dev_default_root/api.pid}"
export REMNOTE_API_LOG_FILE="${REMNOTE_API_LOG_FILE:-$remnote_dev_default_root/api.log}"
export REMNOTE_API_STATE_FILE="${REMNOTE_API_STATE_FILE:-$remnote_dev_default_root/api.state.json}"
export REMNOTE_PLUGIN_SERVER_PID_FILE="${REMNOTE_PLUGIN_SERVER_PID_FILE:-$remnote_dev_default_root/plugin-server.pid}"
export REMNOTE_PLUGIN_SERVER_LOG_FILE="${REMNOTE_PLUGIN_SERVER_LOG_FILE:-$remnote_dev_default_root/plugin-server.log}"
export REMNOTE_PLUGIN_SERVER_STATE_FILE="${REMNOTE_PLUGIN_SERVER_STATE_FILE:-$remnote_dev_default_root/plugin-server.state.json}"

remnote_dev_has_arg() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    if [[ "$item" == "$needle" || "$item" == "$needle="* ]]; then
      return 0
    fi
  done
  return 1
}

remnote_dev_repo_root() {
  printf '%s\n' "$REMNOTE_DEV_REPO_ROOT"
}

remnote_dev_root_dir() {
  printf '%s\n' "$remnote_dev_default_root"
}

remnote_dev_ws_url() {
  printf 'ws://127.0.0.1:%s/ws\n' "$REMNOTE_WS_PORT"
}
