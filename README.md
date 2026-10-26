# tmuxaxxing

tmux sidebars for running many Claude Code sessions at once. Inspired by [tmux-agent-status](https://github.com/samleeney/tmux-agent-status).

- **Agents sidebar (left):** every Claude Code session with its state, and an INBOX of sessions that are asking for permission or have finished since you last looked. Approve or reject a permission prompt from the sidebar without switching to the session.
- **GitHub sidebar (right):** review requests, your open PRs with CI state, and PRs assigned to you.
- **Slack toggle:** one key switches to an always-running [`slk`](https://github.com/gammons/slk) and back.
- **Plugins:** any sidebar slot can hold your own feed script or TUI.

Works in any terminal that runs tmux (Ghostty, iTerm2 and others).

## Requirements

- tmux 3.8 (older versions are untested), [Bun](https://bun.sh) 1.4, Claude Code 2.1.310 or newer
- Optional: `gh` (logged in) for the GitHub sidebar, `slk` for Slack

## Install

```sh
git clone https://github.com/kolezka/tmuxaxxing.git
cd tmuxaxxing
./scripts/install.sh
```

The script installs dependencies and prints the lines to add to `~/.tmux.conf`. It never edits your config. Sourcing `tmux/tmuxaxxing.tmux.conf` sets `status-right`, `status-interval` and the window-status formats, so put any of your own overrides after it. Sessions report their state through a Claude Code mod, so start Claude with `claude --plugin-dir <repo>/mod`, or add `<repo>/mod` to `CLAUDE_CODE_PLUGIN_DIRS`.

## Keys

| Key | Does |
|---|---|
| `prefix a` | Show or hide the agents sidebar |
| `prefix g` | Show or hide the GitHub sidebar |
| `prefix R` | Reload sidebars after editing `layout.toml` |
| `prefix s` | Switch to Slack and back (replaces tmux's session picker on that key) |

In a sidebar: `j`/`k` move, `Enter` opens the session or item, `r` refreshes, `Tab` switches between plugins in one sidebar. In the agents sidebar: `y` approves once, `x` rejects, `n` jumps to the next INBOX item.

Approving from the sidebar presses the key in the real Claude Code dialog. It only ever sends "yes, once" or "no", and sends nothing if the question changed or the dialog is no longer on screen.

## Layout and plugins

`~/.config/tmuxaxxing/layout.toml` decides which plugin sits where:

```toml
[left]
plugins = ["agents"]
width = 32

[right]
plugins = ["github-prs"]   # several plugins become tabs
width = 36
```

A plugin is a folder in `~/.config/tmuxaxxing/plugins/<name>/` with a `plugin.toml`. A plugin with the same name as a built-in one replaces it.

**Feed plugin:** a command that prints JSON. The sidebar draws it and handles keys and refresh.

```toml
kind = "feed"
command = "./feed.sh"
refresh = "2m"
```

```json
{"sections":[{"title":"TODO","items":[
  {"id":"t1","icon":"●","color":"work","text":"Write README","meta":"today",
   "action":"open https://example.com"}]}]}
```

Colors: `work`, `ask`, `done`, `error`, `dim`, `info`. Invalid output, a non-zero exit or a timeout shows as an error row, and the last good data stays on screen marked stale.

**TUI plugin:** your own program, which gets the whole pane. It must be the only plugin in its slot.

```toml
kind = "tui"
command = "my-tui"
```

It receives `TMUXAXXING_SLOT`, `TMUXAXXING_WIDTH` and `TMUXAXXING_STATE_DIR`. Agent state lives in `$TMUXAXXING_STATE_DIR/agents/<pane-id>.json`.

## Development

```sh
bun test
bunx tsc --noEmit -p .
```

How the pieces fit, from the tmux hook that splits the panes to the mod that writes agent state, is in `docs/architecture.md`. Design and plans are in `docs/superpowers/`. Manual checks for the tmux behaviour are in `docs/manual-checks.md`.
