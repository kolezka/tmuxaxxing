# tmuxaxxing: how it works

This is the map of the whole repo. It answers one question first, "how do the sidebar panes get into tmux", and then walks through every other part: the sidebar process, plugins, the Claude Code mod, agent state, approvals, the status line, and the files on disk.

Verified against the code at commit `3fde029` (merge of PR #2). Where the design spec says something the code does not do yet, the gap is listed at the end.

## 1. The big picture

```
 ~/.tmux.conf  ──source──▶  tmux/tmuxaxxing.tmux.conf
                               │  hooks, keys, status line
                               ▼
                 scripts/ensure-sidebars.sh  (per window)
                               │  tmux split-window
                               ▼
      ┌───────────────────── tmux window ─────────────────────┐
      │ left pane         │ your panes        │ right pane    │
      │ bun cli.ts        │ claude, shells    │ bun cli.ts    │
      │  sidebar --slot   │                   │  sidebar      │
      │  left             │                   │  --slot right │
      │   └─ agents TUI   │                   │   └─ feed UI  │
      └───────┬───────────┴─────────┬─────────┴───────┬───────┘
              │ reads               │ writes          │ runs
              ▼                     ▼                 ▼
   ~/.cache/tmuxaxxing/agents/   Claude Code mod    plugins/github-prs/feed.ts
   seen/  answered/  feeds/      (mod/hooks)        (gh GraphQL, cached)
```

Three processes matter:

- **tmux** runs hooks and key bindings from `tmux/tmuxaxxing.tmux.conf`. It never knows what a "sidebar" is. It only knows panes that carry a pane option `@tmuxaxxing_slot` set to `left` or `right`.
- **The sidebar process** is `bun src/cli.ts sidebar --slot <left|right>`, one per sidebar pane. It reads `layout.toml`, finds the plugins for its slot and either runs a TUI plugin or draws feed plugins with Ink.
- **The Claude Code mod** in `mod/` runs inside each Claude Code session. It writes one JSON file per session describing its state. The agents sidebar reads those files.

Everything talks through files under `~/.cache/tmuxaxxing/` and through tmux commands. There is no daemon and no socket of our own.

## 2. How panes get added to tmux

This is the core mechanism. Read `tmux/tmuxaxxing.tmux.conf` and `scripts/ensure-sidebars.sh` side by side.

### 2.1 The trigger: tmux hooks

The conf file installs two hooks in slot `[47]`:

```
set-hook -g 'after-new-window[47]' 'run-shell -b ".../ensure-sidebars.sh #{window_id}"'
set-hook -g 'session-created[47]'  'run-shell -b ".../ensure-sidebars.sh #{window_id}"'
```

Every time tmux creates a window (or a session, which creates its first window), it runs the script in the background (`-b`) with the new window's id, for example `@3`. tmux expands `#{window_id}` before running the command. The slot number `[47]` matters: tmux hooks are arrays, and using a fixed index means re-sourcing the file replaces our hook instead of adding a second copy, and a hook you set yourself in another index is left alone.

Three other entry points call the same script:

- `prefix a` and `prefix g` run `scripts/toggle-sidebar.sh left|right`. Turning a side on calls `ensure-sidebars.sh` for every window.
- `prefix R` runs `scripts/reload.sh`, which kills every sidebar pane and calls `ensure-sidebars.sh` for every window.

So one script owns pane creation. Everything else just decides when to call it.

### 2.2 The script: `ensure-sidebars.sh <window-id>`

Step by step:

1. **Preconditions.** `tmux` must be on PATH and `TMUXAXXING_ROOT` must be set in the tmux server environment (that is what `set-environment -g TMUXAXXING_ROOT` in your `~/.tmux.conf` is for). If `TMUXAXXING_TMUX_SOCKET` is set, every tmux call gets `-L <socket>`. Tests use that to run on a throwaway server.

2. **Lock per window.** `tmux wait-for -L tmuxaxxing-sidebar-<window-id>` takes a lock inside the tmux server, and an `EXIT` trap releases it with `wait-for -U`. Two hooks can fire for the same window close together (session created plus new window, or a toggle during a reload). The lock makes them run one after another instead of both splitting the window.

3. **Skip Slack.** If the window's session is named `slack`, exit. The `slk` session gets no sidebars.

4. **Read widths.** `bun src/cli.ts widths` prints `<left> <right>` from `layout.toml` (defaults 32 and 36).

5. **Ensure each side.** For `left` (if the global option `@tmuxaxxing_left` is `on`) and `right` (if `@tmuxaxxing_right` is `on`), `ensure_slot` does:
   - List the window's panes with `#{@tmuxaxxing_slot}`. If any pane already carries this side's name, return. That is the whole idempotency check: the marker lives on the pane, so a second run finds it and does nothing.
   - Otherwise split:
     ```
     tmux split-window -d -P -F '#{pane_id}' -t <window-id> <flags> -l <width> <command>
     ```
     `-d` keeps focus where it was, `-P -F '#{pane_id}'` prints the new pane's id, `-l <width>` sets the width in columns. The flags are the only difference between sides: `-hbf` for left (horizontal split, **b**efore the target so it lands on the left, **f**ull window height) and `-hf` for right.
   - Mark it: `tmux set-option -p -t <pane-id> @tmuxaxxing_slot left|right`. This pane option is the only thing that makes a pane "a sidebar". `toggle-sidebar.sh`, `reload.sh`, `status`, the `pane-focus-in` hook and the agents model all look for it.

   The command run in the pane is `bun <root>/src/cli.ts sidebar --slot <side>`, quoted with `printf %q`. Tests override it with `TMUXAXXING_SIDEBAR_CMD` (they use `sleep 600`) so the wiring can be tested without Ink.

6. **Resize.** `resize_slot` sets both sidebars to their configured width with `resize-pane -x`. That makes `prefix R` after a width change in `layout.toml` take effect on existing panes too.

### 2.3 What tmux ends up with

For a window `@3` with one shell pane `%7`:

```
tmux list-panes -t @3 -F '#{pane_id} #{pane_width} #{@tmuxaxxing_slot}'
%8  32 left
%7  91
%9  36 right
```

Hide a side with `prefix a` or `prefix g`: the global option flips to `off` and every pane with that slot marker is killed across all windows (`list-panes -a`). Show it again: the option flips to `on` and `ensure-sidebars.sh` runs for every window. Because the state lives in a global tmux option, a window created while a side is `off` does not get that side.

### 2.4 The other hooks in the conf

- **`pane-focus-in[47]`** runs `bun src/cli.ts seen <pane-id>` when a pane that is **not** a sidebar gets focus (`if-shell -F "#{==:#{@tmuxaxxing_slot},}"` checks the marker is empty). That writes `~/.cache/tmuxaxxing/seen/<pane-id>` with the current time, which drops the pane's `done` entry from INBOX. Sidebars are excluded so clicking into a sidebar does not mark the wrong thing seen.
- **`status-right`** runs `bun src/cli.ts status` every `status-interval` (2 seconds). See section 7.
- **Window status formats** append `●` when the window option `@tmuxaxxing_dot` is set, which `status` sets per window.
- **`MouseDown1Status`** makes the `slk` chip in the status line clickable: if the click lands in the status range named `slk`, it runs `slack-toggle.sh`, otherwise it does tmux's normal "select this window".

## 3. The sidebar process

Entry point: `src/cli.ts`. It is a tiny dispatcher with five commands:

| Command | Who calls it | What it does |
|---|---|---|
| `sidebar --slot left\|right` | `ensure-sidebars.sh` (in the pane) | Runs the slot's plugins |
| `widths` | `ensure-sidebars.sh` | Prints the two widths from `layout.toml` |
| `status` | tmux `status-right` every 2 s | Prints counters, sets the window dots |
| `seen <pane-id>` | `pane-focus-in` hook | Marks a pane seen |
| `agents` | the built-in `agents` plugin | Runs the agents TUI |

### 3.1 `sidebar` (`src/cli/sidebar.ts`)

1. Load `~/.config/tmuxaxxing/layout.toml` with `loadLayout`. A missing file means the defaults. A broken file renders the error in red inside the pane and exits, so you see why a sidebar is empty.
2. Discover plugins from two directories, built-ins first: `<repo>/plugins/` then `~/.config/tmuxaxxing/plugins/`. A user plugin with the same folder name wins because it is read later and overwrites the map entry.
3. `resolveSlot` maps the slot's plugin names to definitions. Unknown names become error entries that render as a red line.
4. Branch on plugin kind:
   - **Exactly one plugin and it is `tui`:** spawn its `command` with `/bin/sh -c`, cwd set to the plugin folder, stdin/stdout/stderr inherited so it owns the pane. Environment gets `TMUXAXXING_SLOT`, `TMUXAXXING_WIDTH`, `TMUXAXXING_STATE_DIR`. The sidebar process waits for it and passes its exit code on.
   - **A `tui` plugin mixed with others:** error line, because a TUI needs the whole pane.
   - **Only `feed` plugins:** render `SlotApp` with Ink.

### 3.2 Feed rendering: `SlotApp` and `FeedPanel`

`src/ui/SlotApp.tsx` holds one tab per feed plugin. It calls `loadFeed` on mount and then on an interval (the plugin's `refresh`, default 2 minutes). `Tab` cycles tabs when there is more than one. `src/ui/FeedPanel.tsx` draws sections and items, keeps the selected row, handles `j`/`k`/`r`/`Enter`, and only renders the rows that fit (`src/ui/window.ts`, `visibleRange`). The spike showed both Ink and OpenTUI break when handed more lines than the pane has, so windowing is not optional.

`Enter` runs the item's `action` string with `/bin/sh -c` in the plugin's folder, detached, output ignored. For the GitHub plugin that is `open '<url>'`.

### 3.3 Feed fetching: `src/feed/runner.ts`

`getFeed(def, { cacheDir, now, timeoutMs, force })` is what makes ten windows not mean ten `gh` calls:

- Cache file: `~/.cache/tmuxaxxing/feeds/<plugin>.json` holding `{ fetchedAt, feed, error }`.
- If the cache is younger than the plugin's `refresh` and `force` is false, return it. No command runs.
- Otherwise take a lock by `mkdir <plugin>.lock`. The one pane that gets the lock runs the command (20 s timeout, process group killed on timeout). The others poll until the lock disappears and then read the fresh cache. A lock older than twice the timeout is treated as abandoned and removed.
- A non-zero exit, timeout or JSON that fails the zod schema (`src/feed/schema.ts`) writes the error into the cache next to the **previous good feed**. The panel then shows the old rows plus a red error line marked `(stale)`. A failure never looks like an empty list.

### 3.4 The agents TUI: `agents` command

`plugins/agents/plugin.toml` is `kind = "tui"`, `command = "bun ../../src/cli.ts agents"`. So the left sidebar is a sidebar process that spawns a second bun process running `AgentsApp`. That indirection is deliberate: the agents sidebar is "just the first plugin", and you can replace it by dropping a folder named `agents` into your user plugins directory.

`src/ui/agents/AgentsApp.tsx` polls every second (`pollMs: 1000`):

1. `tmux list-panes -a` with a tab-separated format (pane id, pid, window id, window index, slot marker, `automatic-rename`, session name, window name last because names can contain tabs).
2. `readAgentDir(~/.cache/tmuxaxxing/agents, liveness)` reads every `*.json`. A record whose pane is not in the list or whose pid is dead is dropped. A record that does not parse becomes an error row naming the file.
3. Reads `seen/` and `answered/`.
4. `buildAgentsModel` (`src/ui/agents/model.ts`) groups records by tmux window id, labels each group with the project folder (`basename(cwd)`) when tmux still auto-names the window, or with the window name when you renamed it. It builds INBOX from `buildInbox` (section 5) and shows a record as `running` instead of `ask` when the `answered/` marker says we already sent a `yes` for that request.

Keys: `j`/`k` move, `n` jumps to the first INBOX item, `Enter` switches the tmux client to that pane and marks it seen, `y` approves once, `x` rejects. Selection follows the row's identity, not its index, so a poll that reorders rows does not move it under your cursor.

## 4. The Claude Code mod: where agent state comes from

`mod/` is a Claude Code plugin with one hooks module, `mod/hooks/register.ts`. Load it with `claude --plugin-dir <repo>/mod` or via `CLAUDE_CODE_PLUGIN_DIRS`. Without it the agents sidebar shows nothing, because the mod is the only source of agent state.

What it does on each event:

| Event | Action |
|---|---|
| `session.start` | Read `TMUX_PANE` (for example `%7`). If unset, do nothing for the whole session. Ask tmux for session name, window name and pane pid. Write `agents/%7.json` with state `idle`. |
| `turn.start` (main agent only) | state `working`, title = first non-empty line of the prompt, cut to 60 chars. Written **before** passing the event on, so a very fast turn cannot write `done` before `working`. |
| `tool.check` | After the engine decides: if the verdict is `ask`, the approver is a person and it is the main agent, state `ask` with `question = { requestId: tool_use_id, tool, summary }`. Summary is the Bash command or the file path, cut to 120 chars. |
| `tool.call` (after the tool ran) | If the record is `ask` for this same `tool_use_id`, back to `working`. Otherwise no change. |
| `turn.complete` (main agent only) | state `done`. |
| `session.end` | Remove the file. |

Writes are serialized through a promise queue so parallel tool calls apply in order, and each write is `$.fs.write` to a `.tmp` file followed by `mv`, so a reader never sees a half-written file. Every hook is wrapped so a mod failure is logged to the debug channel and never reaches the session.

The state machine itself is `mod/hooks/transitions.ts`, a pure function `nextRecord(prev, event)` with no mod API imports, which is why `bun test` can cover it. The record shape is mirrored by `src/agents/state.ts`, and the tests parse every mod output with the reader's zod schema so the two cannot drift.

Known gap, recorded in `spike/FINDINGS.md`: no event fires at the moment you press a key in the permission dialog. The next event is `tool.call` finishing. So after an approval the file still says `ask` until the tool ends. The sidebar covers that by showing `running` when it has an `answered/` marker for that request, and the approval guard covers it by refusing to send keys when the dialog is no longer on screen.

## 5. INBOX, seen and done

`src/agents/inbox.ts`:

- `buildInbox(records, seen)` returns every `ask` record, oldest first, followed by every `done` record whose `updatedAt` is newer than its seen mark, oldest first.
- `markSeen(dir, paneId, now)` writes `seen/<pane-id>` containing a timestamp. It is called from the `pane-focus-in` hook (via `cli.ts seen`) and when you press `Enter` on a row in the agents sidebar.
- A seen file that is not a plain number is ignored, which means the pane counts as unseen and its `done` shows again. Wrong in the loud direction, on purpose.

## 6. Approving from the sidebar

Two files: `src/agents/approve.ts` (pure guard) and `src/agents/send-approval.ts` (does the I/O).

`sendApproval({ paneId, expectedRequestId, action })`:

1. If `answered/<pane-id>.json` already names this request, refuse with `already-answered`. Double presses send nothing.
2. `tmux list-panes -a`, re-read the record for this pane with liveness.
3. `tmux capture-pane -p` on the visible screen only (scrollback could hold an old dialog).
4. `checkApproval` refuses unless all of these hold: the record exists and parses, its state is `ask`, its `question.requestId` equals the id you saw when you pressed the key, and the dialog regex matches the capture. The regex keys on the dialog's shape (`Do you want to ...?`, `❯ 1. Yes`, numbered options, `Esc to cancel`), not its wording, so it matches Bash and Write dialogs and does not match the trust-folder dialog.
5. Keys: `yes` sends `1`, which was option 1 in every dialog observed. `no` sends the digit read from the `N. No` line inside the matched dialog, because that digit differs per tool (4 for Bash, 3 for Write). No match means refuse. Option 2 and 3 ("always allow", "switch to auto mode") are never sent.
6. `tmux send-keys`, then write the `answered/` marker atomically.

Every refusal has a reason, and `AgentsApp` shows it in the footer for three seconds, most of them as "changed, open the session instead". A missed approval is acceptable. A wrong one is not, so the guard errs toward refusing.

## 7. The status line

`bun src/cli.ts status` runs every 2 seconds from `status-right`. It:

1. Lists panes, reads agent records with liveness, reads seen marks, builds INBOX.
2. For every window, sets the window option `@tmuxaxxing_dot` to `1` if any INBOX item lives in that window, else empty. The window-status formats print `●` when it is set.
3. Prints the counters `✳<working> ✳<ask> ✳<done>` in yellow, magenta and green, then `slk` wrapped in `#[range=user|slk]...#[norange]` so the mouse binding can tell a click on it apart from a click on a window name.

## 8. Slack

`scripts/slack-toggle.sh` is bound to `prefix s` and to the `slk` chip. If the current client is on the `slack` session, `switch-client -l` goes back to the last session. Otherwise it creates the `slack` session running `slk` if it does not exist and switches to it. Only creation needs `slk` on PATH, so a missing `slk` never blocks the way back. `ensure-sidebars.sh` skips that session, so `slk` gets the whole window.

## 9. Files on disk

Config, `~/.config/tmuxaxxing/` (override with `TMUXAXXING_CONFIG_DIR`):

| Path | Purpose |
|---|---|
| `layout.toml` | Which plugins go in `left` and `right`, and their widths. Missing file means agents left at 32, github-prs right at 36. |
| `plugins/<name>/plugin.toml` | Your plugins. Same name as a built-in replaces it. |

State, `~/.cache/tmuxaxxing/` (override with `TMUXAXXING_STATE_DIR`, also passed to TUI plugins):

| Path | Written by | Read by |
|---|---|---|
| `agents/<pane-id>.json` | the mod | agents sidebar, `status`, approval sender |
| `seen/<pane-id>` | `cli.ts seen`, agents sidebar `Enter` | INBOX |
| `answered/<pane-id>.json` | approval sender | agents sidebar (shows `running`), approval sender (no double send) |
| `feeds/<plugin>.json`, `feeds/<plugin>.lock` | feed runner | every sidebar pane showing that feed |

Environment variables the scripts and CLI understand:

| Variable | Meaning |
|---|---|
| `TMUXAXXING_ROOT` | Repo path. Set in the tmux server environment, required by every script. |
| `TMUXAXXING_TMUX_SOCKET` | Use `tmux -L <name>`. Tests only. |
| `TMUXAXXING_SIDEBAR_CMD` | Replace the sidebar command in new panes. Tests only. |
| `TMUXAXXING_STATE_DIR`, `TMUXAXXING_CONFIG_DIR` | Move the state or config directory. |
| `TMUXAXXING_SLOT`, `TMUXAXXING_WIDTH` | Given to TUI plugins. |

## 10. Repo map

```
tmux/tmuxaxxing.tmux.conf   hooks, keys, status line (source this from ~/.tmux.conf)
scripts/
  install.sh                bun install, prints the lines to add by hand
  ensure-sidebars.sh        creates the two sidebar panes for one window
  toggle-sidebar.sh         prefix a / prefix g
  reload.sh                 prefix R
  slack-toggle.sh           prefix s and the slk chip
src/
  cli.ts                    command dispatcher
  cli/                      sidebar, widths, status, seen, agents
  paths.ts                  state and config directories
  config/layout.ts          layout.toml schema and defaults
  config/plugins.ts         plugin discovery, plugin.toml schema
  feed/schema.ts            the JSON a feed plugin prints
  feed/runner.ts            shared cache, lock, stale fallback
  tmux/tmux.ts              tmux adapter: list-panes, capture-pane, send-keys, jump
  agents/state.ts           reads agents/*.json with liveness and visible errors
  agents/inbox.ts           seen marks and INBOX order
  agents/approve.ts         pure approval guard and dialog regex
  agents/send-approval.ts   guard plus I/O plus answered markers
  ui/SlotApp.tsx            tabs over feed plugins
  ui/FeedPanel.tsx          list rendering and keys for a feed
  ui/window.ts              which rows fit in the pane
  ui/colors.ts              feed color names to Ink colors
  ui/agents/model.ts        groups, labels, INBOX rows, running state
  ui/agents/AgentsApp.tsx   the agents TUI
mod/
  .claude-plugin/plugin.json
  hooks/hooks.json          points at register.ts
  hooks/register.ts         Claude Code event hooks, file writes
  hooks/transitions.ts      pure state machine
plugins/
  agents/plugin.toml        tui, runs `cli.ts agents`
  github-prs/               feed, gh GraphQL searches, section totals
tests/                      bun test, one folder per src area, plus tmux wiring on a throwaway server
docs/superpowers/           design spec and the two implementation plans
docs/manual-checks.md       the tmux checks that are done by hand
spike/FINDINGS.md           measurements the design rests on: keys, mod events, Ink vs OpenTUI, slk
```

## 11. Tests

`bun test` runs everything. Three kinds:

- Pure unit tests for schemas, the state machine, the inbox, the guard, the model and the window math.
- Ink tests with `ink-testing-library` for `FeedPanel`, `SlotApp` and `AgentsApp`.
- `tests/tmux/wiring.test.ts` starts a real tmux server on a random socket with `-f /dev/null`, sources the conf, and checks that `ensure-sidebars.sh` creates exactly one left and one right pane at the configured widths, that running it twice adds nothing, that `slack` gets none, that toggles remove and restore panes, and that every script runs under macOS `/bin/bash` 3.2 without "unbound variable".

Everything tmux-related in tests uses `TMUXAXXING_TMUX_SOCKET`, so your real server is never touched. Interactive behaviour that cannot be asserted this way is listed in `docs/manual-checks.md`.

## 12. Gaps between the spec and the code

- `prefix p` (list loaded plugins and slots) is in the design spec and not in the conf.
- The mailbox direction (sidebar sends a prompt to an idle session through the mod and `$.prompt.submit`) is a stated v1 non-goal and nothing in `src/` or `mod/` implements it.
- Renderers poll (1 s for agents, the plugin's `refresh` for feeds). There is no filesystem watch.
- The `slk` chip shows no unread count. The spike found a documented source (slk's terminal title) but it was not observed in tmux, so it was left out.
- Sidebar width changes need `prefix R`; nothing watches `layout.toml`.
