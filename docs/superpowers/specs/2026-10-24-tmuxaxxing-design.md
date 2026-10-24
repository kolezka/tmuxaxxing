# tmuxaxxing: design

Date: 2026-10-24
Status: draft, awaiting approval

## Intent

The owner runs 8 to 10 iTerm2 tabs with 2 to 4 Claude Code sessions in each, so 16 to 40 sessions at once. Today the only way to find out which session finished or is waiting for permission is to click through tabs. The goal is a tmux setup, inspired by [tmux-agent-status](https://github.com/samleeney/tmux-agent-status), where sessions report their own state into a sidebar, permission prompts can be answered from that sidebar without switching to the session, and the same sidebar system can host the owner's own TUIs as plugins.

The headline value, in the owner's words: not having to jump between sessions is "bardzo super". Everything else supports that.

## Goals

1. **Agents sidebar (left).** Shows every Claude Code session with its state, plus an INBOX of sessions that need attention.
2. **Approve from the sidebar.** A permission prompt shows up in the INBOX with the tool and command. One key approves, one key rejects, with no switch to the session.
3. **GitHub sidebar (right).** Review requests, my open PRs, and PRs assigned to me.
4. **Slack toggle.** One key does a full switch to an always-running `slk` and back to the pane you came from.
5. **Plugin layer.** Which plugin sits in which sidebar is a config edit plus a reload. The owner's own TUIs plug in the same way the built-in ones do.
6. **Claude Code mod** reports session state. It is the only source of agent state.

## Non-goals (v1)

- Agents other than Claude Code (Codex, Devin, Aider).
- Remote or SSH tmux hosts.
- An fzf popup switcher, finish sounds, worktree or session launchers (all of which tmux-agent-status has).
- "Send this PR to a Claude session" from the GitHub sidebar. The mod could later poll an inbox file and call `$.prompt.submit`, but that is not in v1.
- Integration with `cwelux`, the owner's tmux menu-bar app. It is a separate project. It could read the same state files later.
- Terminal-specific features. Ghostty and iTerm2 are both just hosts for tmux, and nothing may depend on either one.

## Anti-goals (a failure even if it technically works)

- **Confidently wrong state.** The sidebar says "done" or "working" while a session is actually waiting for permission. A stale or unreadable state must show as unknown or error, never as a plausible state.
- **An approval key that lands in the wrong place.** It goes to the wrong pane, a dialog that changed, or the prompt input instead of a dialog. A missed approval is acceptable. A wrong one is not.
- **Silent empty lists.** A failed `gh` call or a malformed feed looks like "no PRs". Errors must render as a visible error row.
- **Weakening permissions.** The sidebar must never offer "yes, and don't ask again". It only sends "yes, once" or "no".
- **Re-login or reload churn for Slack.** `slk` keeps running and is never restarted just to toggle.
- **Breaking the owner's existing tmux setup.** The project ships a file the owner sources from `~/.tmux.conf`. It never overwrites that file.
- **Resource hog.** 10 windows must not mean 10 times the `gh` calls or a busy CPU.

## Constraints and environment (verified 2026-10-24)

- macOS, zsh. tmux 3.8, `gh`, `fzf` and `slk` 0.27.0 are installed (`/usr/local/bin/slk`).
- Claude Code 2.1.310. Its mod API (types in the plugin-authoring skill) has these events, among others: `session.start`, `session.end`, `turn.start`, `turn.complete`, `tool.call`, `tool.check`. It also has `$.fs`, `$.env.get`, `$.process.run` and `$.clock.every`. They exist in the types; none has been exercised yet.
- The owner's shell aliases apply to commands run from scripts started in a login shell. Scripts use absolute paths or `command` where that matters.
- The project folder `/Users/me/Development/tmuxaxxing` is not a git repository yet.

## Decided by the owner

- **Sidebar style:** a persistent side pane (option B from the first mockup), not a status-line-only view or a popup.
- **At least two sidebars.** The agents sidebar goes left and GitHub goes right, as shown in the prototype.
- **GitHub contents:** review requests, my open PRs, PRs assigned to me.
- **Slack:** a full switch, not a popup. It uses `slk`.
- **Approve from the sidebar** is wanted.
- **Language:** Bun + TypeScript. The TUI library was handed to me (see below).
- **Integrate with Claude Code mods.**

The prototype the owner reviewed is `.superpowers/brainstorm/71897-1792852067/content/layout-v2.html` (open it directly in a browser). It is the reference for layout and interaction. Its exact strings and colours are not binding.

## Decided by me (owner may override)

### Layout and tmux model

- One tmux session, `work`, with one window per project. Windows replace iTerm tabs. Each window holds 2 to 4 Claude Code panes.
- One tmux session, `slack`, running `slk`.
- Every window in `work` gets a left and a right sidebar pane. They are created by a tmux hook on new windows and can be toggled with `prefix+a` (agents) and `prefix+g` (GitHub). Each sidebar pane runs its own small renderer process, and every renderer reads shared state. Data that is expensive to fetch (GitHub) is fetched once by a shared cache, not once per pane.
- Widths: left 32 columns, right 36. Both are configurable.
- Status line: window list with a dot per window that has something waiting, agent counters (working, asking, done), and a clickable `slk` chip. tmux 3.8 status ranges make it clickable.

### Agent state: the mod

A Claude Code mod in this repo writes one JSON file per session to `~/.cache/tmuxaxxing/agents/<tmux-pane-id>.json`. It writes atomically (temp file plus rename).

| Event | State written |
|---|---|
| `session.start` | `idle`, with pane id (`TMUX_PANE`), tmux session and window, cwd, pid |
| `turn.start` | `working`, plus a short title (first line of the prompt, truncated) |
| `tool.check`, where the engine's verdict beneath is "ask" | `ask`, plus `{ requestId, tool, summary }`, where summary is the command or file path |
| after an ask resolves (the tool runs or is denied) | back to `working` |
| `turn.complete` | `done` |
| `session.end` | file removed |

A session started outside tmux (no `TMUX_PANE`) writes nothing.

**Liveness.** The renderer drops entries whose pane no longer exists (`tmux list-panes -a`) or whose pid is dead. An entry it cannot parse shows as an error row naming the file. It never silently disappears and never shows as a valid state.

**Seen and unread.** A session enters the INBOX when it moves to `ask`, or to `done` without having been viewed since. Focusing the pane (tmux `pane-focus-in` hook) marks it seen, recorded in `~/.cache/tmuxaxxing/seen/<pane-id>`.

### Approving from the sidebar

- The sidebar sends keys to the session's pane with `tmux send-keys`. The real Claude Code permission dialog stays in charge, and the sidebar only presses a key on the owner's behalf.
- The guard, run right before sending: re-read the state file, require `state == ask` and the same `requestId` the owner saw, and check with `tmux capture-pane` that the dialog is visible in the pane. If any check fails, send nothing and show "changed, open the session instead".
- Keys: `y` = yes once, `x` = no. Nothing else is ever sent. The digit each maps to in Claude Code's dialog is confirmed in the spike, not assumed.
- Rejected alternative: deciding inside the mod's `tool.check` hook. It bypasses the visible dialog, and the hook has a time budget that may not allow waiting for a human. It stays a candidate only if the spike shows `send-keys` is unreliable.

### Plugin layer

Config lives in `~/.config/tmuxaxxing/`:

```toml
# layout.toml
[left]
plugins = ["agents"]
width = 32

[right]
plugins = ["github-prs"]   # several plugins = tabs in that sidebar, Tab cycles
width = 36
```

`prefix+R` reloads the layout. Plugins live in `plugins/<name>/plugin.toml`. Built-in plugins ship in this repo, and user plugins in the config folder take precedence over built-ins with the same name.

There are two plugin kinds:

- **`feed`**: a command that prints JSON on stdout. The shared renderer draws it and handles navigation (`j`/`k`), `Enter` (run the item's action) and `r` (refresh). It runs on a refresh interval and/or when a watched path changes.

  ```toml
  kind = "feed"
  command = "./feed.ts"
  refresh = "2m"
  ```

  ```json
  {"sections":[{"title":"REVIEW REQUESTS","items":[
    {"id":"pr-1842","icon":"◆","color":"ask","text":"#1842 Payments retry",
     "meta":"ania · 2h","action":"gh pr view 1842 --web"}]}]}
  ```

  Feed output is validated with a zod schema exported from the repo. Invalid output, a non-zero exit or a timeout renders as an error row with the reason. The last good data is kept, marked stale.

- **`tui`**: a command that owns the whole pane. It gets `TMUXAXXING_SLOT` (left or right), `TMUXAXXING_WIDTH` and `TMUXAXXING_STATE_DIR` in its environment. The agents sidebar may be a `tui` plugin because of its approval keys. That is the builder's call.

`prefix+p` lists the loaded plugins and their slots.

### GitHub plugin

A `feed` plugin built on `gh` with `--json`. It has three sections: review requests, my open PRs (with CI and review state), and PRs assigned to me. Refresh is every 2 minutes plus `r`. `Enter` opens the PR in the browser. A single cache file under `~/.cache/tmuxaxxing/` is shared by every pane. A `gh` failure (auth, network, rate limit) shows as an error row.

### Slack

- `prefix+s`: if the client is on `slack`, switch back to the last session (`switch-client -l`). Otherwise switch to `slack`, creating it with `slk` if it does not exist.
- The status line chip does the same on click.
- An unread count on the chip only ships if `slk` exposes one somewhere a script can read (to be checked). Otherwise the chip shows `slk` with no number.

### Stack

- Bun + TypeScript throughout. The mod is TypeScript against the Claude Code mod API.
- TUI library: **Ink by default**, compared against **OpenTUI** in the spike. Keep Ink unless it flickers, lags or misbehaves under Bun in a 32-column pane with about 40 sessions. The renderer sits behind the feed schema, so changing the library later does not touch plugins.
- zod for the feed schema. Bun's built-in TOML parsing for config.
- `tmux.conf` fragment + small shell scripts for bindings and hooks.
- Tests: `bun test`, plus `ink-testing-library` (or the OpenTUI equivalent) for the renderer. Feed parsing, state reading (missing, malformed and valid files as separate cases) and the approval guard get unit tests. tmux behaviour is checked by hand against a written checklist.

### Install

The repo provides `tmuxaxxing.tmux.conf`, which the owner sources from `~/.tmux.conf`, plus `bun install` and the mod loaded as a Claude Code plugin from the repo folder. Ghostty and iTerm2 configs are not touched.

## First step: spike (throwaway)

These must be answered before the real build, because the design hangs on them:

1. **`send-keys` approval.** In a real Claude Code session in tmux, trigger a permission prompt and approve or reject it from another pane with `send-keys`. Record which keys map to "yes once" and "no", and how reliably `capture-pane` detects the dialog.
2. **Mod events.** Confirm that `turn.start`, `tool.check` (and how an "ask" verdict is recognised), `turn.complete` and `session.end` fire as expected. Confirm that `TMUX_PANE` is readable from the mod. Find how the mod learns that an ask was answered.
3. **Ink vs OpenTUI under Bun** in a narrow tmux pane with about 40 fake sessions updating.
4. **`slk` unread count:** is it readable anywhere?

If spike 1 fails, stop and revisit approvals with the owner before building on it.

## Left to the builder

- Exact JSON field names for state files and feeds, beyond the shapes above.
- How renderers notice changes (fs watch vs polling), within the "no resource hog" anti-goal.
- Colours, glyphs, and wording of UI strings (English).
- Repo layout, and whether the agents sidebar is a `feed` or a `tui` plugin.
- The exact `gh` queries.
