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

if [[ "$#" -ne 1 ]]; then
  printf '%s\n' 'usage: ensure-sidebars.sh <window-id>' >&2
  exit 1
fi

tmux_args=()
if [[ -n "${TMUXAXXING_TMUX_SOCKET:-}" ]]; then
  tmux_args=(-L "$TMUXAXXING_TMUX_SOCKET")
fi

tmux_cmd() {
  "$tmux_bin" ${tmux_args[@]+"${tmux_args[@]}"} "$@"
}

window_id="$1"
lock="tmuxaxxing-sidebar-${window_id}"
tmux_cmd wait-for -L "$lock"
trap 'tmux_cmd wait-for -U "$lock"' EXIT

session="$(tmux_cmd display-message -p -t "$window_id" '#{session_name}')"
if [[ "$session" == 'slack' ]]; then
  exit 0
fi

read -r left_width right_width < <(bun "$TMUXAXXING_ROOT/src/cli.ts" widths)

ensure_slot() {
  local side="$1"
  local width="$2"
  local split_flags="$3"
  local slot

  while IFS= read -r slot; do
    if [[ "$slot" == "$side" ]]; then
      return
    fi
  done < <(tmux_cmd list-panes -t "$window_id" -F '#{@tmuxaxxing_slot}')

  local sidebar_command
  if [[ -n "${TMUXAXXING_SIDEBAR_CMD:-}" ]]; then
    sidebar_command="$TMUXAXXING_SIDEBAR_CMD"
  else
    printf -v sidebar_command '%q %q %q %q %q' "$(command -v bun)" "$TMUXAXXING_ROOT/src/cli.ts" sidebar --slot "$side"
  fi

  local pane_id
  pane_id="$(tmux_cmd split-window -d -P -F '#{pane_id}' -t "$window_id" "$split_flags" -l "$width" "$sidebar_command")"
  tmux_cmd set-option -p -t "$pane_id" @tmuxaxxing_slot "$side"
}

resize_slot() {
  local side="$1"
  local width="$2"
  local pane_id slot

  while IFS='|' read -r pane_id slot; do
    if [[ "$slot" == "$side" ]]; then
      tmux_cmd resize-pane -t "$pane_id" -x "$width"
      return
    fi
  done < <(tmux_cmd list-panes -t "$window_id" -F '#{pane_id}|#{@tmuxaxxing_slot}')
}

if [[ "$(tmux_cmd show-options -gqv @tmuxaxxing_left)" == 'on' ]]; then
  ensure_slot left "$left_width" -hbf
fi

if [[ "$(tmux_cmd show-options -gqv @tmuxaxxing_right)" == 'on' ]]; then
  ensure_slot right "$right_width" -hf
fi

resize_slot left "$left_width"
resize_slot right "$right_width"
