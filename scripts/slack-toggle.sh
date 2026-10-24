#!/usr/bin/env bash
set -euo pipefail

if ! tmux_bin="$(command -v tmux)"; then
  printf '%s\n' 'tmux not found' >&2
  exit 1
fi

tmux_args=()
if [[ -n "${TMUXAXXING_TMUX_SOCKET:-}" ]]; then
  tmux_args=(-L "$TMUXAXXING_TMUX_SOCKET")
fi

tmux_cmd() {
  "$tmux_bin" ${tmux_args[@]+"${tmux_args[@]}"} "$@"
}

if [[ -n "${TMUX_PANE:-}" ]]; then
  current_session="$(tmux_cmd display-message -p -t "$TMUX_PANE" '#{session_name}')"
else
  current_session="$(tmux_cmd display-message -p '#{session_name}')"
fi

if [[ "$current_session" == 'slack' ]]; then
  tmux_cmd switch-client -l
  exit 0
fi

if ! tmux_cmd has-session -t '=slack' 2>/dev/null; then
  # Only creating the session needs slk, so a missing slk never blocks the way back.
  if ! slk_bin="$(command -v slk)"; then
    tmux_cmd display-message 'slk not found'
    exit 1
  fi
  printf -v slk_command '%q' "$slk_bin"
  tmux_cmd new-session -d -s slack "$slk_command"
fi

tmux_cmd switch-client -t '=slack'
