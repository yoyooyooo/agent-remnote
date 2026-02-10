#!/usr/bin/env bash
set -euo pipefail

# tmux-friendly wrapper for `remnote-right-value.sh`.
#
# Output: tmux style string, or nothing.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
value_script="${SCRIPT_DIR}/remnote-right-value.sh"
if [[ ! -x "${value_script}" ]]; then
  exit 0
fi

out="$("${value_script}" 2>/dev/null || true)"
out="${out//$'\n'/}"
if [[ -z "${out}" ]]; then
  exit 0
fi

bg="${out%%$'\t'*}"
value="${out#*$'\t'}"

fg="${TMUX_REMNOTE_FG:-#eceff4}"
printf '#[fg=%s,bg=%s] %s #[default]' "${fg}" "${bg}" "${value}"

