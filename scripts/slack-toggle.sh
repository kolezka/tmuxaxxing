#!/usr/bin/env bash
set -euo pipefail

if ! tmux_bin="$(command -v tmux)"; then
  printf '%s\n' 'tmux not found' >&2
  exit 1
fi

if ! slk_bin="$(command -v slk)"; then
  "$tmux_bin" display-message 'slk not found'
  exit 1
fi

if [[ -n "${TMUX_PANE:-}" ]]; then
  current_session="$("$tmux_bin" display-message -p -t "$TMUX_PANE" '#{session_name}')"
else
  current_session="$("$tmux_bin" display-message -p '#{session_name}')"
fi

if [[ "$current_session" == 'slack' ]]; then
  "$tmux_bin" switch-client -l
  exit 0
fi

if ! "$tmux_bin" has-session -t '=slack' 2>/dev/null; then
  printf -v slk_command '%q' "$slk_bin"
  "$tmux_bin" new-session -d -s slack "$slk_command"
fi

"$tmux_bin" switch-client -t '=slack'
