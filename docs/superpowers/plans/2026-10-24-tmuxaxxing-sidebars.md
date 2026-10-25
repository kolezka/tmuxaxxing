# tmuxaxxing Sidebars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tmuxaxxing usable day to day: a Claude Code mod reports session state, Ink sidebars show agents and GitHub PRs, `y`/`x` approve from the sidebar, and tmux creates the sidebars and status line on its own.

**Architecture:** The mod writes `AgentRecord` files through a pure transition function. A tmux adapter wraps every `tmux` call. One CLI (`src/cli.ts`) runs the sidebars, the status line and small hook commands. Ink components render on top of the modules merged in PR #1. Shell scripts plus `tmux/tmuxaxxing.tmux.conf` wire everything into tmux.

**Tech Stack:** Bun 1.4.2, TypeScript, Ink + React, ink-testing-library, zod, tmux 3.8, Claude Code 2.1.310 mod API.

**Spec:** `docs/superpowers/specs/2026-10-24-tmuxaxxing-design.md`. Spike results: `spike/FINDINGS.md`. Previous plan: `docs/superpowers/plans/2026-10-24-tmuxaxxing-spike-and-core.md`.

## Global Constraints

- Everything in the first plan's Global Constraints still holds (state and config dirs and their env overrides, widths 32/36, visible errors, English UI, never touching `~/.tmux.conf`).
- Approvals send only `1` (yes) or the digit parsed from the dialog's "No" line, through `checkApproval` in `src/agents/approve.ts`. Nothing else sends keys to a Claude pane.
- The mod never changes a tool decision or a turn. Every mod hook returns what `next(e)` returned, and any mod failure is caught and leaves the session unaffected.
- Every tmux call goes through `src/tmux/tmux.ts`. Tests use an isolated server (`-L tmxtest-<random>`) and kill it afterwards. Nothing in tests touches the owner's tmux server.
- No sidebars in the `slack` session.
- Owner decisions: Slack stays on `prefix+s`. TUI library is Ink.

## Review Focus

1. **The mod cannot write its state file** (state dir unwritable or `tmux` missing): the Claude session goes on normally and the tool decision is unchanged. Pinned in Task 1 (try/catch in every hook, and `claude plugin validate` reports no gating hook without a catch).
2. **More rows than the pane is tall** (the spike saw Ink scroll the header off the top): the list windows around the selection and the header stays visible. Pinned in Task 3.
3. **The same ask approved from two windows' sidebars**: the second press sends nothing (`already-answered`). Pinned in Task 2.
4. **The new-window hook firing twice, or firing in the `slack` session**: exactly one left and one right sidebar per window, and none in `slack`. Pinned in Task 5.
5. **`y` pressed on a row that is not an ask**: no keys sent, and a short inline message. Pinned in Task 4.

---

## Wave A (parallel): Tasks 1, 2, 3, 6

### Task 1: State transitions and the Claude Code mod

**Files:**
- Create: `mod/.claude-plugin/plugin.json`, `mod/hooks/hooks.json`, `mod/hooks/register.ts`, `mod/hooks/transitions.ts`
- Test: `tests/mod/transitions.test.ts`

**Interfaces:**
- Consumes: `AgentRecord` and `parseAgentRecord` from `src/agents/state.ts` (the test checks every produced record with `parseAgentRecord`).
- Produces: `type ModEvent = { kind: 'session.start'; paneId: string; session: string; window: string; cwd: string; pid: number; now: number } | { kind: 'turn.start'; text: string; now: number } | { kind: 'ask'; requestId: string; tool: string; summary: string; now: number } | { kind: 'tool.done'; requestId: string; now: number } | { kind: 'turn.complete'; now: number }`; `nextRecord(prev: AgentRecord | null, ev: ModEvent): AgentRecord | null`; `titleOf(text: string): string` (first non-empty line, at most 60 chars, ending in `…` when cut); `summaryOf(tool: string, input: unknown): string` (Bash `command`, else `file_path`, else the tool name, at most 120 chars).

Transition rules: `session.start` creates `idle`. `turn.start` sets `working` and `title`. `ask` sets `ask` and `question`. `tool.done` returns to `working` only when `prev.state === 'ask'` and the request ids match; otherwise it leaves `prev` unchanged. `turn.complete` sets `done` and drops `question`. Any event other than `session.start` with `prev === null` returns `null` (nothing to update). Every change sets `updatedAt = now`.

Mod glue (`register.ts`), using the event fields recorded in FINDINGS section 2:
- `session.start`: if `$.env.get('TMUX_PANE')` is empty, the session writes nothing. Otherwise `$.process.run(['tmux','display','-p','-t',pane,'#{session_name}\t#{window_name}\t#{pane_pid}'])` gives session, window and pid.
- `turn.start` (only when `agentId` is null): `turn.start` event.
- `tool.check`: `const verdict = await next(e)`. If `verdict.decision === 'ask'`, `e.approver === 'person'`, there is no `agentId` and `tool_use_id` is set, emit `ask`. Always `return verdict`.
- `tool.call`: `const r = await next(e)`, then emit `tool.done` with `tool_use_id`, then `return r`.
- `turn.complete` (main loop only): `turn.complete`. `session.end`: remove the file.
- Writes go to `<state>/agents/<paneId>.json`, where `<state>` is `TMUXAXXING_STATE_DIR` or `$HOME/.cache/tmuxaxxing`. They are atomic: `$.fs.write` to `<file>.tmp`, then `$.process.run(['mv', tmp, file])`. Removal uses `['rm','-f',file]`. `mkdir -p` the dir on `session.start`.
- Every hook body is wrapped so an error is logged with `$.ui.log` and swallowed. The hook still returns `next`'s result.

- [ ] **Step 1: Write failing tests** for `nextRecord`: the full cycle start, turn, ask, tool.done, complete, with every record passing `parseAgentRecord`; `tool.done` with a different requestId leaves the state `ask`; `turn.complete` clears `question`; `nextRecord(null, turn.start)` is `null`; `titleOf` cuts a 100-char line to 60 with `…`; `summaryOf('Bash', {command: 'touch x'}) === 'touch x'`; `summaryOf('Write', {file_path: '/a/b'}) === '/a/b'`.
- [ ] **Step 2: Run** `bun test tests/mod`, expect FAIL.
- [ ] **Step 3: Implement** `transitions.ts`, then `register.ts` and the two JSON files (layout as in the plugin-authoring skill; types at `/private/tmp/claude-501/bundled-skills/2.1.310/35df52c05da6f0015cba449fe89bb857/plugin-authoring/types/claude-code.d.ts`).
- [ ] **Step 4: Run** `bun test tests/mod`, expect PASS. Run `claude plugin validate mod`: expect no errors, and no "gating hook without .catch" line (Review Focus 1).
- [ ] **Step 5: Live check** in an isolated server, the way the spike did it: `tmux -L tmxmod new-session -d -s m1 -c <scratch git repo> 'TMUXAXXING_STATE_DIR=<tmp> claude --permission-mode default --plugin-dir <abs>/mod'`. Send a prompt that needs approval and confirm `<tmp>/agents/%N.json` reads `ask` with the command in `summary`. Approve with `1`, then confirm `working`, then `done`. `/exit` and confirm the file is gone. Kill the server.
- [ ] **Step 6: Commit** `feat: add Claude Code mod that writes session state`

### Task 2: tmux adapter and approval sender

**Files:**
- Create: `src/tmux/tmux.ts`, `src/agents/send-approval.ts`
- Test: `tests/tmux/tmux.test.ts`, `tests/agents/send-approval.test.ts`

**Interfaces:**
- Consumes: `readAgentDir`, `AgentEntry`, `Liveness` (Task 7 of plan 1); `checkApproval`, `APPROVAL_CONFIG`, `ApprovalAction`, `GuardResult` (plan 1 Task 9).
- Produces:
  - `type PaneInfo = { paneId: string; pid: number; session: string; window: string; windowId: string; slot: string | null }` (`slot` is the pane option `@tmuxaxxing_slot`)
  - `type Tmux = { listPanes(): Promise<PaneInfo[]>; capturePane(paneId: string): Promise<string>; sendKeys(paneId: string, keys: string[]): Promise<void>; jumpTo(paneId: string): Promise<void>; run(args: string[]): Promise<string> }`
  - `createTmux(opts?: { socket?: string }): Tmux` (`socket` defaults to env `TMUXAXXING_TMUX_SOCKET`, passed as `-L`)
  - `isPidAlive(pid: number): boolean`
  - `livenessFrom(panes: PaneInfo[]): Liveness`
  - `type Answered = { requestId: string; action: ApprovalAction; at: number }`; `readAnswered(stateDir: string): Promise<Map<string, Answered>>`
  - `type SendResult = GuardResult | { send: false; reason: 'already-answered' }`
  - `sendApproval(args: { paneId: string; expectedRequestId: string; action: ApprovalAction }, deps: { tmux: Tmux; stateDir: string; now: number }): Promise<SendResult>`

`sendApproval`: refuse with `already-answered` if `answered/<paneId>.json` holds the same requestId. Read `agents/<paneId>.json` through `readAgentDir` with liveness from `tmux.listPanes()`. Run `capturePane`, then `checkApproval`. Only when it says send: `sendKeys`, then write `answered/<paneId>.json` atomically. `capturePane` uses `capture-pane -p -t <id>` (visible screen only, no scrollback). `jumpTo` runs `switch-client -t <session>`, then `select-window -t <windowId>`, then `select-pane -t <paneId>`.

- [ ] **Step 1: Write failing tests.** `tmux.test.ts` against an isolated server: `listPanes` returns the created pane with its pid; `sendKeys` then `capturePane` shows the typed text; `@tmuxaxxing_slot` set with `set-option -p` comes back as `slot`; the server is killed in `afterAll`. `send-approval.test.ts` with a fake `Tmux` that records `sendKeys` calls and returns fixture captures from `tests/fixtures/panes/`: a matching ask plus a Bash dialog and `no` gives keys `['4']` and an answered marker; each refusal reason (`gone`, `unreadable`, `not-asking`, `changed`, `dialog-not-visible`, `no-option-not-found`) gives zero `sendKeys` calls and no marker; **Review Focus 3:** a second call with the same requestId gives `already-answered` and zero new `sendKeys` calls.
- [ ] **Step 2: Run** `bun test tests/tmux tests/agents/send-approval.test.ts`, expect FAIL.
- [ ] **Step 3: Implement** with `Bun.spawn` and the tmux binary from `Bun.which('tmux')`.
- [ ] **Step 4: Run** the same tests, expect PASS.
- [ ] **Step 5: Commit** `feat: add tmux adapter and guarded approval sender`

### Task 3: Ink feed panel, slot app and CLI entry

**Files:**
- Create: `src/ui/colors.ts`, `src/ui/window.ts`, `src/ui/FeedPanel.tsx`, `src/ui/SlotApp.tsx`, `src/cli.ts`
- Test: `tests/ui/window.test.ts`, `tests/ui/FeedPanel.test.tsx`, `tests/ui/SlotApp.test.tsx`

**Interfaces:**
- Consumes: `getFeed`, `FeedView` (plan 1 Task 6); `ResolvedSlot`, `resolveSlot`, `discoverPlugins` and `loadLayout` (plan 1 Task 5).
- Produces:
  - `inkColor(c?: Color): string` (work yellow, ask magenta, done green, error red, dim gray, info blue)
  - `visibleRange(total: number, selected: number, height: number): { start: number; end: number }`
  - `<FeedPanel view: FeedView; width: number; height: number; onAction(item: FeedItem): void; onRefresh(): void />`
  - `<SlotApp slot: ResolvedSlot; width: number; height: number; loadFeed(def: PluginDef, force: boolean): Promise<FeedView>; runAction(cmd: string, cwd: string): void />`
  - CLI `bun src/cli.ts sidebar --slot left|right`, and `bun src/cli.ts widths` (prints `<left> <right>`)

Behaviour: `FeedPanel` renders the section titles, then items as `icon text` with `meta` dimmed, cut to `width`. An empty section shows `(none)`. A `view.error` row is red at the top, with `stale` when `view.stale`. `j`/`k` move, `Enter` runs `onAction`, `r` runs `onRefresh`. The list windows by `visibleRange` with the header always visible. `SlotApp` shows a tab bar only with more than one entry (`Tab` cycles), shows `ok: false` entries as red rows `<name>: <error>`, and polls each feed every `refreshMs` (default 120000) through `loadFeed`. `sidebar`: load the layout (a `LayoutError` renders as a red row, never a crash) and resolve the slot. If the slot holds exactly one `tui` plugin, run its command with inherited stdio, `cwd = plugin.dir` and env `TMUXAXXING_SLOT`, `TMUXAXXING_WIDTH`, `TMUXAXXING_STATE_DIR`. A `tui` plugin next to other plugins renders the row `tui plugin <name> must be alone in its slot`. Otherwise render `SlotApp` with `getFeed` (cache dir `<state>/feeds`, timeout 20000). Built-in plugins dir: `<repo>/plugins`. User dir: `<config>/plugins`.

- [ ] **Step 1:** `bun add ink react` and `bun add -d ink-testing-library @types/react`.
- [ ] **Step 2: Write failing tests:** `visibleRange(100, 0, 10)` gives `{0,10}`; `(100, 50, 10)` keeps 50 inside the range; `(5, 4, 10)` gives `{0,5}`. **Review Focus 2:** `FeedPanel` with 40 items at height 12 shows the first section title and the selected item in `lastFrame()` after pressing `j` 30 times. An error view shows the error text and `stale`. An empty section shows `(none)`. `Enter` calls `onAction` with the selected item. `SlotApp` with an `ok: false` entry renders `github-pr: unknown plugin`. Two feed entries render a tab bar, and `Tab` switches the shown title.
- [ ] **Step 3: Run** `bun test tests/ui`, expect FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** `bun test tests/ui`, expect PASS. Run `bunx tsc --noEmit -p .`, expect exit 0.
- [ ] **Step 6: Live check:** in `tmux -L tmxui`, a 36-column pane running `bun src/cli.ts sidebar --slot right` shows the three GitHub sections. Capture it with `capture-pane -p` and attach the capture (no PR titles) in the report.
- [ ] **Step 7: Commit** `feat: add Ink feed panel, slot app and CLI`

### Task 6: GitHub section totals

**Files:**
- Modify: `plugins/github-prs/feed.ts`, `plugins/github-prs/map.ts`, `tests/plugins/github-prs.test.ts`

**Interfaces:**
- Produces: `mapPrsToFeed(input: { review: GhPr[]; mine: GhPr[]; assigned: GhPr[]; totals: { review: number; mine: number; assigned: number } }, now: number): Feed`. Section titles become `REVIEW REQUESTS (68)`, or `(100 of 132)` when the fetched count is below the total. `feed.ts` reads `issueCount` from the same GraphQL search.

- [ ] **Step 1: Write failing tests:** 2 fetched with total 2 gives `REVIEW REQUESTS (2)`; 100 fetched with total 132 gives `(100 of 132)`; 0 gives `(0)`, still with the `(none)`-ready empty items list.
- [ ] **Step 2: Run** `bun test tests/plugins`, expect FAIL. **Step 3: Implement.** **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `feat: show PR section totals and truncation`

---

## Wave B (after Wave A): Tasks 4, 5

### Task 4: Agents sidebar

**Files:**
- Create: `src/ui/agents/model.ts`, `src/ui/agents/AgentsApp.tsx`, the built-in plugin `plugins/agents/plugin.toml` (`kind = "tui"`, `command = "bun ../../src/cli.ts agents"`)
- Modify: `src/cli.ts` (add `agents`, `seen <paneId>`)
- Test: `tests/ui/agents-model.test.ts`, `tests/ui/AgentsApp.test.tsx`

**Interfaces:**
- Consumes: `readAgentDir`, `buildInbox`, `readSeen`, `markSeen`, `Tmux`, `livenessFrom`, `sendApproval`, `readAnswered`, `visibleRange`, `inkColor`.
- Produces: `type Row = { kind: 'agent'; record: AgentRecord; display: 'idle' | 'working' | 'ask' | 'running' | 'done' } | { kind: 'error'; file: string; error: string }`; `buildAgentsModel(entries: AgentEntry[], seen: SeenMap, answered: Map<string, Answered>): { inbox: Row[]; groups: Array<{ label: string; rows: Row[] }>; errors: Row[] }`; `<AgentsApp deps: { tmux: Tmux; stateDir: string; now(): number; pollMs: number } width: number; height: number />`

Rules: an `ask` whose requestId has an answered `yes` displays as `running` and is left out of the INBOX. That covers the spike's gap, where no event fires between approval and the tool finishing. Groups are labelled `session/window`. Keys: `j`/`k` move over INBOX, then groups, then errors. `Enter` jumps (`tmux.jumpTo`) and marks the session seen. `y`/`x` on an ask row call `sendApproval`. A refusal shows an inline message for 3 s: `changed, open the session instead` for `changed`, `dialog-not-visible`, `no-option-not-found` and `already-answered`, and `gone` or `unreadable` as written. `n` jumps to the first INBOX row. The INBOX row shows `tool: summary` under the session line, wrapped to the width. Polling runs every `pollMs` (1000).

- [ ] **Step 1: Write failing tests:** model: an ask with an answered yes gives `running` and stays out of the INBOX; an error entry goes to `errors`; groups are ordered by `session/window`. App with a fake `Tmux` and a temp state dir: `y` on an ask row calls `sendKeys` once with `['1']`. **Review Focus 5:** `y` on a done row gives zero `sendKeys` calls and the frame shows `not an approval`. `Enter` calls `jumpTo` with the paneId and writes the seen file. Fifty sessions at height 15 keep `INBOX` in the frame.
- [ ] **Step 2: Run** `bun test tests/ui/agents-model.test.ts tests/ui/AgentsApp.test.tsx`, expect FAIL. **Step 3: Implement.** **Step 4: Run**, expect PASS, and `tsc` exit 0.
- [ ] **Step 5: Commit** `feat: add agents sidebar with INBOX and approvals`

### Task 5: tmux wiring and status line

**Files:**
- Create: `scripts/ensure-sidebars.sh`, `scripts/toggle-sidebar.sh`, `scripts/reload.sh`
- Modify: `tmux/tmuxaxxing.tmux.conf`, `src/cli.ts` (add `status`), `docs/manual-checks.md`
- Test: `tests/tmux/wiring.test.ts`, `tests/cli/status.test.ts`

**Interfaces:**
- Consumes: `createTmux`, `livenessFrom`, `readAgentDir`, `buildInbox`, `readSeen`, CLI `widths`, CLI `sidebar`.
- Produces: tmux bindings `prefix+a` (toggle left), `prefix+g` (toggle right), `prefix+R` (reload), `prefix+s` (kept). Global options `@tmuxaxxing_left` and `@tmuxaxxing_right` (`on`/`off`, default `on`). Pane option `@tmuxaxxing_slot`. Window option `@tmuxaxxing_dot`. CLI `status` prints the status-right string.

Behaviour:
- `ensure-sidebars.sh <window-id>`: exit if the window's session is `slack`. For each side that is `on` and has no pane with that `@tmuxaxxing_slot` in the window, run `split-window -d -t <window> -hbf` (left) or `-hf` (right) with `-l <width>` from `cli widths`, command `bun <root>/src/cli.ts sidebar --slot <side>`, then `set-option -p -t <new-pane> @tmuxaxxing_slot <side>`.
- `toggle-sidebar.sh <side>`: flip the option. For `off`, kill every pane with that slot. For `on`, ensure every window.
- `reload.sh`: kill all slot panes, then ensure every window.
- Hooks in the conf: `after-new-window` and `session-created` run `ensure-sidebars.sh #{window_id}`. `pane-focus-in` runs `run-shell -b "bun <root>/src/cli.ts seen #{pane_id}"` only when `#{@tmuxaxxing_slot}` is empty.
- `status-interval 2` and `status-right '#(bun <root>/src/cli.ts status)'`.
- `status` prints `#[fg=yellow]✳<working> #[fg=magenta]✳<ask> #[fg=green]✳<done>#[default] #[range=user|slk]slk#[norange]` and, as a side effect, sets `@tmuxaxxing_dot` on each window to `1` or `""` for whether it has an INBOX row. The conf's `window-status-format` and `window-status-current-format` append `#{?@tmuxaxxing_dot,●,}`.
- `bind -n MouseDown1Status` runs `slack-toggle.sh` when `#{mouse_status_range}` is `slk`, and otherwise does tmux's default `select-window -t =`.
- `<root>` comes from `TMUXAXXING_ROOT`, as in the existing conf.

- [ ] **Step 1: Write failing tests:** `wiring.test.ts` on an isolated server, with `TMUXAXXING_ROOT` set to the worktree and the sidebar command replaced through env `TMUXAXXING_SIDEBAR_CMD='sleep 600'`, so the test doesn't need Ink. **Review Focus 4:** ensure on a window gives exactly one left pane (width 32) and one right pane (width 36); ensure twice still gives exactly 2 slot panes; ensure in session `slack` gives 0; toggle left off gives 0 left panes in every window. `status.test.ts`: a temp state dir with 2 working, 1 ask and 1 done gives output containing `✳2`, `✳1`, `✳1` and `range=user|slk`.
- [ ] **Step 2: Run** `bun test tests/tmux/wiring.test.ts tests/cli/status.test.ts`, expect FAIL. **Step 3: Implement.** **Step 4: Run**, expect PASS. Also measure: `time bun src/cli.ts status` over 10 runs, and report the mean.
- [ ] **Step 5:** Add the sidebar checks to `docs/manual-checks.md`: new window gets both sidebars, `prefix+a`/`g` toggle, `prefix+R` reload, the status counters move, the window dot appears, a click on `slk` toggles.
- [ ] **Step 6: Commit** `feat: wire sidebars, hooks and status line into tmux`

---

## Task 7 (lead): Install, README, end-to-end check

**Files:**
- Create: `scripts/install.sh`, `README.md`

- [ ] **Step 1:** `install.sh` runs `bun install --frozen-lockfile` and prints, without writing them, the two lines for `~/.tmux.conf` (`set-environment -g TMUXAXXING_ROOT <repo>` and `source-file <repo>/tmux/tmuxaxxing.tmux.conf`), plus how to load the mod (`claude --plugin-dir <repo>/mod`, or adding it to Claude Code's plugin dirs).
- [ ] **Step 2:** README: what it is, install, keys, how to write a `feed` or `tui` plugin (with the feed JSON example from the spec).
- [ ] **Step 3: End-to-end** on an isolated server with a real Claude session: the left sidebar shows the session; trigger an ask; it appears in the INBOX with the command; press `y` in the sidebar; the command runs and the row shows `running`, then `done`; repeat with `x`.
- [ ] **Step 4:** Full `bun test`, `tsc`, then a PR.
