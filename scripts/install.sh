#!/usr/bin/env bash
# Installs dependencies and prints the lines to add by hand. It never edits your config.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v bun >/dev/null; then
  printf '%s\n' 'bun not found: install it from https://bun.sh first' >&2
  exit 1
fi
if ! command -v tmux >/dev/null; then
  printf '%s\n' 'tmux not found' >&2
  exit 1
fi

(cd "$root" && bun install --frozen-lockfile)

cat <<EOF

Done. Two manual steps:

1. Add these lines to ~/.tmux.conf, then run: tmux source-file ~/.tmux.conf

   set-environment -g TMUXAXXING_ROOT $root
   source-file $root/tmux/tmuxaxxing.tmux.conf

2. Load the Claude Code mod so sessions report their state. Either start Claude with

   claude --plugin-dir $root/mod

   or add $root/mod to CLAUDE_CODE_PLUGIN_DIRS (paths joined with ':'), in your
   shell profile or in the "env" block of ~/.claude/settings.json.

Optional: gh (GitHub sidebar) and slk (Slack toggle) must be on PATH.
EOF
