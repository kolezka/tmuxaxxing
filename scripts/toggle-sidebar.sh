#!/usr/bin/env bash
set -euo pipefail

if ! tmux_bin="$(command -v tmux)"; then
  printf '%s\n' 'tmux not found' >&2
  exit 1
fi

if [[ -z "${TMUXAXXING_ROOT:-}" ]]; then
  printf '%s\n' 'TMUXAXXING_ROOT is not set' >&2
  exit 1
fi

if [[ "$#" -ne 1 || ( "$1" != 'left' && "$1" != 'right' ) ]]; then
  printf '%s\n' 'usage: toggle-sidebar.sh <left|right>' >&2
  exit 1
fi

tmux_args=()
if [[ -n "${TMUXAXXING_TMUX_SOCKET:-}" ]]; then
  tmux_args=(-L "$TMUXAXXING_TMUX_SOCKET")
fi

tmux_cmd() {
  "$tmux_bin" ${tmux_args[@]+"${tmux_args[@]}"} "$@"
}

side="$1"
option="@tmuxaxxing_${side}"
if [[ "$(tmux_cmd show-options -gqv "$option")" == 'on' ]]; then
  tmux_cmd set-option -g "$option" off
  while IFS='|' read -r pane_id slot; do
    if [[ "$slot" == "$side" ]]; then
      tmux_cmd kill-pane -t "$pane_id"
    fi
  done < <(tmux_cmd list-panes -a -F '#{pane_id}|#{@tmuxaxxing_slot}')
  exit 0
fi

tmux_cmd set-option -g "$option" on
while IFS= read -r window_id; do
  "$TMUXAXXING_ROOT/scripts/ensure-sidebars.sh" "$window_id"
done < <(tmux_cmd list-windows -a -F '#{window_id}')
