# tmuxaxxing Spike and Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer the four open questions the design hangs on (spike), then build the parts of tmuxaxxing that do not depend on those answers: feed schema, config and plugin loading, the shared feed cache, agent state reading, the INBOX, the approval guard, the GitHub feed plugin and the Slack toggle.

**Architecture:** Pure TypeScript modules under `src/`, each with one job and unit tests, so the renderer, the mod and the tmux wiring can be built on them later. The spike runs first in a throwaway `spike/` folder, and only its findings file is kept.

**Tech Stack:** Bun 1.4.2, TypeScript, zod, Bun's built-in TOML parser, `bun test`, tmux 3.8, `gh`, Claude Code 2.1.310.

**Spec:** `docs/superpowers/specs/2026-10-24-tmuxaxxing-design.md`

**Scope note.** The spec covers six subsystems. This plan covers the spike plus the subsystems that do not depend on its answers. A second plan covers the Claude Code mod, the sidebar renderer (Ink or OpenTUI), approval sending, and the tmux wiring for sidebars and the status line. It is written from `spike/FINDINGS.md` once this plan's Task 4 is done, because those parts' interfaces depend on what the spike finds.

## Global Constraints

- Bun + TypeScript throughout. Runtime validation with zod. Config parsed with Bun's built-in TOML support (`Bun.TOML.parse`).
- State dir: `~/.cache/tmuxaxxing/` (agents in `agents/<tmux-pane-id>.json`, seen marks in `seen/<pane-id>`, feed caches in `feeds/`). Override with env `TMUXAXXING_STATE_DIR`. Every test uses a temp dir through this override.
- Config dir: `~/.config/tmuxaxxing/` (`layout.toml`, `plugins/<name>/plugin.toml`). Override with env `TMUXAXXING_CONFIG_DIR`.
- Default widths: left 32 columns, right 36. Default layout: left `["agents"]`, right `["github-prs"]`.
- GitHub feed refresh: every 2 minutes (`refresh = "2m"`).
- Approval: only "yes once" and "no" are ever sent. Never "yes, and don't ask again".
- Errors are visible: an unreadable state file, failed feed or malformed config produces an error value the UI can show. It never produces an empty or plausible-looking result.
- UI strings are English.
- Nothing writes to `~/.tmux.conf` or to Ghostty or iTerm2 config. The project ships `tmux/tmuxaxxing.tmux.conf` for the owner to source.
- Work happens on branch `feat/spike-and-core` in a git worktree, never directly on `main`.

## Review Focus

1. **A state file read mid-write or truncated** (`{"paneId":"%3","sta`): it must show as an error entry naming the file, not crash the reader and not vanish. Pinned in Task 7.
2. **`gh` fails** (not logged in, offline, rate limited) after a good fetch: the sidebar must show the error and keep the last good PRs marked stale, not an empty list. Pinned in Task 6.
3. **10 windows with 10 GitHub sidebars refreshing at once:** exactly one `gh` run, with all ten reading the shared cache. Pinned in Task 6.
4. **The question changes between the owner seeing it and pressing `y`:** a different `requestId` or the dialog gone means no keys are sent. Pinned in Task 9.
5. **`layout.toml` names a plugin that does not exist** (typo `github-pr`): a visible "unknown plugin" error for that slot, not a silently empty sidebar. Pinned in Task 5.

---

## Phase A: Spike (throwaway)

Spike code lives in `spike/` and is deleted at the end of Task 4. Only `spike/FINDINGS.md` is committed. Spikes get no tests. Each task ends by writing its section of `FINDINGS.md`.

Use a separate tmux server for all spike work: `tmux -L tmxspike ...`. This keeps the owner's own tmux sessions untouched.

### Task 1: Spike 1, approving a permission prompt with send-keys (GATE)

**Files:**
- Create: `spike/approve/` (scratch git repo for Claude to work in)
- Create: `spike/FINDINGS.md`, section `## 1. send-keys approval`

- [ ] **Step 1: Start Claude Code in a spike tmux server**

```bash
mkdir -p spike/approve && git -C spike/approve init -q
tmux -L tmxspike new-session -d -s s1 -x 160 -y 45 -c "$PWD/spike/approve" 'claude'
```

Start it in the default permission mode, so `Bash(touch ...)` asks. If the owner's settings auto-allow it, pick another command that asks and note which one.

- [ ] **Step 2: Trigger a prompt and capture the dialog**

Send the prompt `Run exactly this with the Bash tool: touch yes-marker.txt` with `tmux -L tmxspike send-keys -t s1 '<prompt>' Enter`. Poll `tmux -L tmxspike capture-pane -p -t s1` until the permission dialog shows. Save the captured text verbatim to `FINDINGS.md`.

- [ ] **Step 3: Approve from outside the pane**

Send the key the dialog shows for "Yes" (for example `1`) with `send-keys`. Pass: `spike/approve/yes-marker.txt` exists. Record the exact key string.

- [ ] **Step 4: Reject from outside the pane**

Repeat with `touch no-marker.txt` and the key for "No". Pass: `no-marker.txt` does not exist, and Claude reports the denial. Record the key.

- [ ] **Step 5: Show what a key does with no dialog open**

With the session idle, send the "yes" key. Record where it lands: it is expected to be typed into the prompt input, which is why the guard exists.

- [ ] **Step 6: Write the dialog detection pattern**

From the captured dialogs, write one regular expression that matches an open permission dialog and does not match the idle screen. Check it against both captures and record both results.

- [ ] **Step 7: GATE**

If Step 3 or Step 4 failed, or no reliable pattern exists for Step 6, **stop here**. Write what failed in `FINDINGS.md` and report to the owner before any further task. The spec says approvals are revisited with the owner in that case.

### Task 2: Spike 2, mod events at runtime

**Files:**
- Create: `spike/mod/.claude-plugin/plugin.json`, `spike/mod/hooks/hooks.json`, `spike/mod/hooks/register.ts`
- Modify: `spike/FINDINGS.md`, section `## 2. mod events`

- [ ] **Step 1: Write a logging mod**

It hooks `session.start`, `turn.start`, `tool.call`, `tool.check`, `turn.complete` and `session.end`. Each hook calls `next(e)` unchanged and appends one JSON line to `/tmp/tmx-spike-events.jsonl`: the event name, `Date.now()`, the `TMUX_PANE` value from `$.env.get`, and the input fields of interest. For `tool.check`, also log the value `await next(e)` resolved to. For `tool.call`, log before and after `await next(e)`. Follow the plugin-authoring skill for file layout and run `claude plugin validate spike/mod`.

- [ ] **Step 2: Run one session through a full cycle**

`tmux -L tmxspike new-session -d -s s2 -c "$PWD/spike/approve" 'claude --plugin-dir ../mod'`. Send one prompt that needs an approval, approve it with the key from Task 1, let the turn finish, then `/exit`.

- [ ] **Step 3: Record answers in FINDINGS.md**

From the log, answer each question with the log line as evidence:
- Did every event fire, and in what order?
- Is `TMUX_PANE` readable, and what is its value format?
- What does `tool.check`'s `next(e)` resolve to when the dialog is about to show? Write the exact field and value that means "ask".
- Is there a stable id for the request that a sidebar can match against (`requestId` in the spec)? If not, which fields together identify it?
- Which event shows that the ask was answered (tool ran, or was denied)?

### Task 3: Spike 3, Ink vs OpenTUI under Bun

**Files:**
- Create: `spike/tui/ink.tsx`, `spike/tui/opentui.tsx`, `spike/tui/package.json`
- Modify: `spike/FINDINGS.md`, section `## 3. TUI library`

- [ ] **Step 1: Build the same screen twice**

Both scripts render a list of 40 fake sessions (glyph, `window/pane`, title), and change the state of 3 random sessions every 250 ms. `j`/`k` move a highlight, `q` quits. One script uses Ink, the other OpenTUI's React binding.

- [ ] **Step 2: Measure in a 32-column pane**

Run each with `bun` in `tmux -L tmxspike` in a pane exactly 32 columns wide, for 60 seconds. Record:
- time to first frame
- average `%cpu` from `ps -o %cpu= -p <pid>` sampled every 5 s
- visible flicker or tearing (yes/no, with a description)
- whether `j`/`k` stay responsive
- any Bun runtime error

- [ ] **Step 3: Decide by the spec's rule**

Keep Ink unless it flickers, lags or misbehaves under Bun. Record the choice and the measurement that decided it.

### Task 4: Spike 4, slk unread count, then close the spike

**Files:**
- Modify: `spike/FINDINGS.md`, section `## 4. slk unread`
- Delete: everything under `spike/` except `FINDINGS.md`

- [ ] **Step 1: Look for an unread count, read-only**

Check `slk --help`, the slk docs URL it prints, `~/.config/slk/config.toml`, `~/.cache/slk/` and `~/.local/share/slk/` (list the files, and inspect the schema of any SQLite file with `sqlite3 <file> .schema`). Do not modify slk's files. Record whether an unread count is readable, from where, and the exact command that reads it. If none exists, write "none found" and the paths checked.

- [ ] **Step 2: Tear down and commit the findings**

```bash
tmux -L tmxspike kill-server
find spike -mindepth 1 ! -name FINDINGS.md -delete
git add spike/FINDINGS.md
git commit -m "docs: record spike findings for approvals, mod events, TUI lib, slk"
```

Check with `git show --stat HEAD` that only `spike/FINDINGS.md` is in the commit.

---

## Phase B: Core (library-independent)

### Task 5: Project setup, feed schema, layout and plugin config

**Files:**
- Create: `package.json`, `tsconfig.json`, `src/paths.ts`
- Create: `src/feed/schema.ts`, `src/config/layout.ts`, `src/config/plugins.ts`
- Test: `tests/feed/schema.test.ts`, `tests/config/layout.test.ts`, `tests/config/plugins.test.ts`

**Interfaces:**
- Produces:
  - `paths.ts`: `stateDir(): string`, `configDir(): string` (env override, else the defaults in Global Constraints)
  - `schema.ts`: `type Color = 'work' | 'ask' | 'done' | 'error' | 'dim' | 'info'`; `type FeedItem = { id: string; text: string; icon?: string; color?: Color; meta?: string; action?: string }`; `type FeedSection = { title: string; items: FeedItem[] }`; `type Feed = { sections: FeedSection[] }`; `type FeedResult = { ok: true; feed: Feed } | { ok: false; error: string }`; `parseFeed(stdout: string): FeedResult`
  - `layout.ts`: `type SlotConfig = { plugins: string[]; width: number }`; `type Layout = { left: SlotConfig; right: SlotConfig }`; `DEFAULT_LAYOUT: Layout`; `class LayoutError extends Error`; `parseLayout(toml: string): Layout`; `loadLayout(path: string): Promise<Layout>`
  - `plugins.ts`: `type PluginDef = { name: string; kind: 'feed' | 'tui'; command: string; dir: string; refreshMs: number | null }`; `parseDuration(s: string): number`; `discoverPlugins(dirs: string[]): Promise<{ plugins: Map<string, PluginDef>; errors: string[] }>`; `type ResolvedSlot = { width: number; entries: Array<{ ok: true; plugin: PluginDef } | { ok: false; name: string; error: string }> }`; `resolveSlot(slot: SlotConfig, plugins: Map<string, PluginDef>): ResolvedSlot`

- [ ] **Step 1: Set up the project**

`bun init` equivalent by hand: `package.json` (name `tmuxaxxing`, `"type": "module"`, script `"test": "bun test"`), strict `tsconfig.json`, `bun add zod`. Run `bun test` and expect "0 tests".

- [ ] **Step 2: Write failing tests**

`schema.test.ts`:
- `parseFeed` of the spec's example JSON (the `#1842 Payments retry` item) returns `ok: true` and the same item.
- `parseFeed('not json')` returns `ok: false`, and `error` contains `"invalid JSON"`.
- `parseFeed('{"sections":[{"title":"X","items":[{"text":"no id"}]}]}')` returns `ok: false`, and `error` names the `id` path.
- `parseFeed('{"sections":[]}')` returns `ok: true` with zero sections (a feed may be legitimately empty).
- An unknown `color` value returns `ok: false`.

`layout.test.ts`:
- `parseLayout` of the spec's `layout.toml` example equals `{ left: { plugins: ['agents'], width: 32 }, right: { plugins: ['github-prs'], width: 36 } }`.
- A TOML with only `[left]` fills `right` from `DEFAULT_LAYOUT`.
- `parseLayout('[left\n')` throws `LayoutError`.
- `width = 0` or `width = "wide"` throws `LayoutError`.
- `loadLayout` of a missing path resolves to `DEFAULT_LAYOUT`, and `loadLayout` of a malformed file rejects with `LayoutError`. These are two separate tests.

`plugins.test.ts`:
- `parseDuration('2m') === 120000`, `parseDuration('30s') === 30000`, and `parseDuration('soon')` throws.
- `discoverPlugins([builtinDir, userDir])` with a `github-prs` in both returns the user one (its `dir` is under `userDir`).
- A `plugin.toml` with `kind = "widget"` lands in `errors` with the plugin name, and not in `plugins`.
- `resolveSlot({ plugins: ['github-pr'], width: 36 }, plugins)` returns one entry `{ ok: false, name: 'github-pr', error: 'unknown plugin' }` (Review Focus 5).

- [ ] **Step 3: Run tests, expect them to fail**

Run: `bun test tests/feed tests/config`. Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

Use zod schemas for the feed and layout shapes. Turn zod issues into one readable string that includes the path. `refresh` is optional in `plugin.toml`, giving `refreshMs: null`.

- [ ] **Step 5: Run tests, expect them to pass**

Run: `bun test tests/feed tests/config`. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock tsconfig.json src tests
git commit -m "feat: add feed schema, layout and plugin config loading"
```

### Task 6: Shared feed cache and runner

**Files:**
- Create: `src/feed/runner.ts`
- Test: `tests/feed/runner.test.ts`, `tests/fixtures/feeds/` (small shell scripts used as feed commands)

**Interfaces:**
- Consumes: `PluginDef`, `parseFeed`, `FeedResult`, `Feed` from Task 5; `stateDir()`.
- Produces: `type FeedView = { feed: Feed | null; error: string | null; stale: boolean; fetchedAt: number | null }`; `getFeed(def: PluginDef, opts: { cacheDir: string; now: number; timeoutMs: number; force?: boolean }): Promise<FeedView>`

Behaviour: the cache file `<cacheDir>/<name>.json` holds `{ fetchedAt, feed, error }`. If the cache is younger than `refreshMs` and `force` is not set, return it without running anything. Otherwise take a lock (`mkdir <cacheDir>/<name>.lock`, which fails if it already exists). With the lock: run `def.command` with `cwd = def.dir`, kill it at `timeoutMs`, `parseFeed` its stdout, write the cache atomically (temp file + rename) and remove the lock. Without the lock, wait for the lock to go away (poll every 100 ms, up to `timeoutMs`) and return what is cached. On failure (non-zero exit, timeout or invalid output), keep the last good `feed`, set `error` to the reason (with the first line of stderr if any), and set `stale: true`. A lock older than `2 * timeoutMs` counts as abandoned and is removed.

- [ ] **Step 1: Write failing tests**

- A good fixture command gives `feed` set, `error: null`, `stale: false`.
- A second call within `refreshMs` does not run the command. The fixture appends a line to a counter file on each run, and the count stays 1.
- **Review Focus 3:** ten concurrent `getFeed` calls with an empty cache give a counter of 1, and all ten return the same `fetchedAt`.
- **Review Focus 2:** a good run, then the fixture switched to `exit 1` with stderr `gh: not logged in`, then `force: true`, gives `feed` still holding the old items, `stale: true`, and an `error` containing `not logged in`.
- A command that prints invalid JSON gives an `error` containing `invalid JSON`, never an empty feed.
- A command that sleeps past `timeoutMs` gives an `error` containing `timeout`.
- A stale lock directory older than `2 * timeoutMs` does not block a fetch.

- [ ] **Step 2: Run tests, expect them to fail**

Run: `bun test tests/feed/runner.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `getFeed` in `src/feed/runner.ts`** with `Bun.spawn`.

- [ ] **Step 4: Run tests, expect them to pass**

Run: `bun test tests/feed/runner.test.ts`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/feed/runner.ts tests/feed/runner.test.ts tests/fixtures/feeds
git commit -m "feat: add shared feed cache with lock and stale fallback"
```

### Task 7: Agent state reading and liveness

**Files:**
- Create: `src/agents/state.ts`
- Test: `tests/agents/state.test.ts`

**Interfaces:**
- Consumes: `stateDir()`.
- Produces: `type AgentState = 'idle' | 'working' | 'ask' | 'done'`; `type AgentQuestion = { requestId: string; tool: string; summary: string }`; `type AgentRecord = { paneId: string; session: string; window: string; cwd: string; pid: number; state: AgentState; title?: string; question?: AgentQuestion; updatedAt: number }`; `type AgentEntry = { ok: true; file: string; record: AgentRecord } | { ok: false; file: string; error: string }`; `type Liveness = { panes: Set<string>; isPidAlive: (pid: number) => boolean }`; `parseAgentRecord(text: string): AgentRecord` (throws on invalid); `readAgentDir(dir: string, live: Liveness): Promise<AgentEntry[]>`

Field names in `AgentRecord` may be adjusted to match `spike/FINDINGS.md` section 2 (for example, the `requestId` source). If they change, update this Interfaces block and Task 9's too.

Rules: `question` is required when `state` is `ask`, and invalid otherwise. A record whose `paneId` is not in `live.panes`, or whose `pid` is not alive, is dropped. A file that cannot be read or parsed stays in the result as `ok: false`, even if its pane is unknown, because its pane cannot be checked. Entries are sorted by `session`, `window`, then `paneId`.

- [ ] **Step 1: Write failing tests**

- Missing directory: `readAgentDir` returns `[]`.
- Empty directory: returns `[]` (a separate test from the missing case).
- A valid file for a live pane and pid returns one `ok: true` entry with the record.
- **Review Focus 1:** a truncated file `{"paneId":"%3","sta` returns `ok: false`, with `file` ending `%3.json` and an `error` that names it as invalid.
- `state: "ask"` without `question` gives `ok: false`.
- Pane `%9` not in `live.panes` means the entry is dropped.
- Pane live but `isPidAlive` false means the entry is dropped (a pane id reused after a tmux restart).
- A valid file and a malformed file in the same dir return both: one `ok: true` and one `ok: false`. A positive control.

- [ ] **Step 2: Run tests, expect them to fail**

Run: `bun test tests/agents/state.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** with a zod schema for `AgentRecord`.

- [ ] **Step 4: Run tests, expect them to pass**

Run: `bun test tests/agents/state.test.ts`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/agents/state.ts tests/agents/state.test.ts
git commit -m "feat: read agent state files with liveness and visible errors"
```

### Task 8: INBOX and seen marks

**Files:**
- Create: `src/agents/inbox.ts`
- Test: `tests/agents/inbox.test.ts`

**Interfaces:**
- Consumes: `AgentRecord` from Task 7.
- Produces: `type SeenMap = Map<string, number>`; `readSeen(dir: string): Promise<SeenMap>` (file `seen/<pane-id>` holds a ms timestamp); `markSeen(dir: string, paneId: string, now: number): Promise<void>`; `buildInbox(records: AgentRecord[], seen: SeenMap): AgentRecord[]`

Rules: a record is in the INBOX if `state === 'ask'`, or `state === 'done'` and `updatedAt > (seen.get(paneId) ?? 0)`. Order: all `ask` first, then `done`, each oldest `updatedAt` first, because the longest waiting goes first.

- [ ] **Step 1: Write failing tests**

- An `ask` record is in the INBOX even if seen after its `updatedAt`.
- A `done` record with `updatedAt` 100 and seen 50 is in. With seen 150 it is out.
- `working` and `idle` records are never in.
- Ordering: given done@10, ask@30, ask@20, the result is ask@20, ask@30, done@10.
- `markSeen` then `readSeen` round-trips. An unparsable seen file is treated as not seen and does not throw.

- [ ] **Step 2: Run tests, expect them to fail**

Run: `bun test tests/agents/inbox.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests, expect them to pass**

Run: `bun test tests/agents/inbox.test.ts`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/agents/inbox.ts tests/agents/inbox.test.ts
git commit -m "feat: build INBOX from agent state and seen marks"
```

### Task 9: Approval guard (pure)

**Files:**
- Create: `src/agents/approve.ts`
- Test: `tests/agents/approve.test.ts`

**Interfaces:**
- Consumes: `AgentEntry` from Task 7; the yes and no keys and the dialog pattern from `spike/FINDINGS.md` section 1.
- Produces: `type ApprovalAction = 'yes' | 'no'`; `type ApprovalConfig = { yesKeys: string[]; noKeys: string[]; dialogPattern: RegExp }`; `APPROVAL_CONFIG: ApprovalConfig` (values from FINDINGS); `type GuardResult = { send: true; keys: string[] } | { send: false; reason: 'gone' | 'unreadable' | 'not-asking' | 'changed' | 'dialog-not-visible' }`; `checkApproval(input: { expectedRequestId: string; current: AgentEntry | undefined; paneText: string }, action: ApprovalAction, config: ApprovalConfig): GuardResult`

This task decides only. Sending keys and capturing the pane are in the second plan.

- [ ] **Step 1: Write failing tests**

Use the two pane captures saved in FINDINGS (open dialog and idle screen) as fixtures in `tests/fixtures/panes/`.

- Matching `requestId`, state `ask` and the dialog capture: `yes` gives `{ send: true, keys: APPROVAL_CONFIG.yesKeys }`, and `no` gives `noKeys`.
- `current` undefined gives `reason: 'gone'`.
- `current` with `ok: false` gives `'unreadable'`.
- State `working` gives `'not-asking'`.
- **Review Focus 4:** state `ask` with a different `requestId` gives `'changed'`.
- Correct state with the idle capture gives `'dialog-not-visible'`.
- `APPROVAL_CONFIG.yesKeys` and `noKeys` are disjoint, and neither contains the key FINDINGS records for "don't ask again". Copy that key into the test as a constant.

- [ ] **Step 2: Run tests, expect them to fail**

Run: `bun test tests/agents/approve.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**, with checks in the order of the reasons listed.

- [ ] **Step 4: Run tests, expect them to pass**

Run: `bun test tests/agents/approve.test.ts`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/agents/approve.ts tests/agents/approve.test.ts tests/fixtures/panes
git commit -m "feat: add approval guard that refuses on any state change"
```

### Task 10: GitHub PRs feed plugin

**Files:**
- Create: `plugins/github-prs/plugin.toml`, `plugins/github-prs/feed.ts`, `plugins/github-prs/map.ts`
- Test: `tests/plugins/github-prs.test.ts`, `tests/fixtures/gh/gh` (a fake `gh` executable)

**Interfaces:**
- Consumes: `Feed` and `FeedItem` from Task 5.
- Produces: `type GhPr = { number: number; title: string; url: string; repo: string; author: string; updatedAt: string; isDraft: boolean; ci: 'pass' | 'fail' | 'pending' | null; review: 'approved' | 'changes_requested' | 'review_required' | null }`; `mapPrsToFeed(input: { review: GhPr[]; mine: GhPr[]; assigned: GhPr[] }, now: number): Feed`

`plugin.toml`: `kind = "feed"`, `command = "bun ./feed.ts"`, `refresh = "2m"`. `feed.ts` runs `gh` (the exact queries are the builder's call; `gh api graphql` with a search query gives CI and review state across repos), normalizes the result to `GhPr`, and prints `mapPrsToFeed(...)` as JSON. On any `gh` failure it prints nothing to stdout, writes `gh`'s stderr to stderr and exits 1, so the runner shows the error (Task 6).

Mapping: sections `REVIEW REQUESTS`, `MY OPEN PRS` and `ASSIGNED TO ME`, in that order, always present even if empty. Item `id` is `pr-<repo>-<number>`, `text` is `#<number> <title>`, and `action` is `open '<url>'` (macOS). `meta` holds the author or state and a relative age (`2h`, `3d`). For my PRs, icon and color follow CI: `fail` → `✘`/`error`, `pending` → `●`/`work`, `pass` → `✔`/`done`, and a draft → `◌`/`dim`.

- [ ] **Step 1: Write failing tests**

- `mapPrsToFeed` with empty lists returns the three section titles with no items.
- A review request from `ania`, updated 2 h before `now`, gives `meta` containing `ania` and `2h`.
- My PR with `ci: 'fail'` gives icon `✘` and color `error`. A draft gives `◌`/`dim`.
- The output passes `parseFeed` from Task 5. Assert `ok: true` on the JSON round trip.
- `feed.ts` with the fake `gh` on `PATH` that exits 1 with `HTTP 401` gives the process exit 1, empty stdout and stderr containing `401`.

- [ ] **Step 2: Run tests, expect them to fail**

Run: `bun test tests/plugins/github-prs.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `map.ts` and `feed.ts`**

- [ ] **Step 4: Run tests, expect them to pass**

Run: `bun test tests/plugins/github-prs.test.ts`. Expected: all pass.

- [ ] **Step 5: Check against the real `gh` once, read-only**

Run: `cd plugins/github-prs && bun ./feed.ts | bun -e 'import {parseFeed} from "../../src/feed/schema"; console.log(parseFeed(await Bun.stdin.text()).ok)'`. Expected: `true`, and the printed section counts match the counts on github.com for the owner.

- [ ] **Step 6: Commit**

```bash
git add plugins/github-prs tests/plugins tests/fixtures/gh
git commit -m "feat: add GitHub PRs feed plugin"
```

### Task 11: Slack toggle

**Files:**
- Create: `scripts/slack-toggle.sh`, `tmux/tmuxaxxing.tmux.conf`, `docs/manual-checks.md`

**Interfaces:**
- Produces: a `prefix+s` binding in `tmux/tmuxaxxing.tmux.conf`: `bind-key s run-shell "<repo>/scripts/slack-toggle.sh"`. The second plan extends this file with sidebar and status-line config.

`slack-toggle.sh`: if the client's current session is `slack`, run `tmux switch-client -l`. Otherwise, if `tmux has-session -t slack` fails, create it with `tmux new-session -d -s slack slk`, then `tmux switch-client -t slack`. If `slk` is not on `PATH`, show `tmux display-message "slk not found"` and exit 1. Use absolute paths for tmux and slk where the owner's aliases could interfere.

- [ ] **Step 1: Write `scripts/slack-toggle.sh` and the binding**

Run `shellcheck scripts/slack-toggle.sh` if available, and expect no warnings.

- [ ] **Step 2: Write `docs/manual-checks.md` with the Slack checklist**

1. With no `slack` session, `prefix+s` creates it, shows slk, and the status line shows session `slack`.
2. A second `prefix+s` returns to the exact pane you came from.
3. A third `prefix+s` goes back to slk without restarting it: `tmux display -p -t slack '#{pane_pid}'` is unchanged.
4. With `slk` temporarily off `PATH`, `prefix+s` shows "slk not found".

- [ ] **Step 3: Run the checklist by hand with the owner's tmux**

Source the file once with `tmux source-file tmux/tmuxaxxing.tmux.conf`, which leaves `~/.tmux.conf` untouched. Record pass or fail per item in the PR description.

- [ ] **Step 4: Commit**

```bash
git add scripts/slack-toggle.sh tmux/tmuxaxxing.tmux.conf docs/manual-checks.md
git commit -m "feat: add prefix+s toggle between work and slk"
```

### Task 12: Full suite and second plan

- [ ] **Step 1: Run the full suite once**

Run: `bun test`. Expected: all pass, with exit code 0 reported from `bun test` itself.

- [ ] **Step 2: Write the second plan**

Write `docs/superpowers/plans/<date>-tmuxaxxing-mod-renderer-wiring.md` from `spike/FINDINGS.md` and this plan's Interfaces, covering the mod, the renderer in the chosen library, approval sending (`capture-pane` + `send-keys`), sidebar panes and hooks, the status line and `prefix+R` reload. Hand it to the owner for review before executing.
