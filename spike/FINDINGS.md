# Spike findings

Date: 2026-10-24. Claude Code 2.1.310, tmux 3.8, Bun 1.4.2, macOS. All tmux work ran on a separate server (`tmux -L tmxspike`). Claude was started as `claude --permission-mode default` in a scratch git repo (`spike/approve`), pane 160x45. The session's model was the owner's default (GPT 6 Astra) with the owner's normal plugins loaded.

## 1. send-keys approval

**Gate: PASS.** Approve and reject both work through `tmux send-keys`, and one regex tells an open dialog from an idle screen in every capture taken.

### Results

| Step | Key sent | Observed |
|---|---|---|
| Approve (Bash `touch yes-marker.txt`) | `1` (`send-keys -t s1 '1'`) | `yes-marker.txt` created within 1 s. Transcript: `⏺ Ran touch yes-marker.txt.` |
| Reject (Bash `touch no-marker.txt`) | `4` (`send-keys -t s1 '4'`) | `no-marker.txt` not created. Transcript: `⎿  Interrupted · What should Claude do instead?`, turn ends. |
| Reject (Write `esc-marker.txt`) | `Escape` (`send-keys -t s1 Escape`) | File not created. Transcript: `⎿  User rejected write to esc-marker.txt`, turn ends. |
| Yes key with no dialog | `1` | Typed into the prompt input: the input line changed from `❯ ` to `❯ 1`. Removed again with `BSpace`. This is why the guard is needed. |

### The keys, and a trap: "No" has no fixed digit

The option list depends on the tool:

- Bash dialog: `1. Yes`, `2. Yes, and always allow access to <dir> from this project`, `3. Yes, and switch to auto mode`, `4. No`.
- Write dialog: `1. Yes`, `2. Yes, and switch to accept edits ... for this session (shift+tab)`, `3. No`.

So:

- **yes once = `1`.** It was option 1 in every dialog seen.
- **no = not a fixed digit.** It was `4` for Bash and `3` for Write. Two safe choices:
  - `Escape`. It rejected the Write dialog (observed). It was not tried on a Bash dialog (unverified there). Danger: if the dialog has closed and the turn is running, Escape interrupts the turn. The guard's dialog check must pass first.
  - The digit read from the capture just before sending, with `/^ {1,3}(?:❯ )?(\d)\. No$/m`. It found `4`, `4` and `3` in the three dialog captures and nothing in the six non-dialog captures.
  - Recommendation for Task 9: `noKeys` is the digit parsed from the same capture that passed the dialog check. Refuse to send when no `N. No` line is found. Keep `Escape` as a documented fallback, not the default.
- **"don't ask again" = `2`.** In both dialogs, option 2 is the "Yes, and ..." choice that weakens future prompts ("always allow access to <dir>" for Bash, "switch to accept edits" for Write). Option 3 in the Bash dialog ("switch to auto mode") also weakens permissions. The sidebar must never send `2` or `3` for a yes, and a parsed "No" digit must come only from a line whose text is exactly `No`.
- Not observed: whether pressing `1` approves when the user has moved the highlight off option 1. The regex below requires `❯ 1. Yes`, so a moved highlight makes the guard refuse, which is the safe direction.

### Dialog detection regex

```
/^ Do you want to [^\n]*\?\n ❯ 1\. Yes\n(?:   \d\. [^\n]*\n)+\n Esc to cancel/m
```

Checked with Bun against every capture saved this session:

| Capture | Result |
|---|---|
| Bash dialog, `touch yes-marker.txt` | MATCH |
| Bash dialog, `touch no-marker.txt` | MATCH |
| Write dialog, `esc-marker.txt` | MATCH |
| Idle after startup | no match |
| Idle after reject | no match |
| Idle with stray `1` in the input | no match |
| Screen after approve | no match |
| Screen 2 s after reject | no match |
| Screen after Escape reject | no match |

The heading varies (`Do you want to proceed?` for Bash, `Do you want to create esc-marker.txt?` for Write), so the regex keys on the shape, not the wording. A long option label (the Bash option 2 path) can wrap in a narrow pane and break the `   \d. ` line rule. All captures here are 160 columns wide. Test narrower panes in the second plan, or relax the option-line rule.

### Other send-keys behaviour seen

- In one case, `send-keys '<prompt>' Enter` left the prompt text in the input without submitting it, and a later separate `Enter` did not submit it either. The screen also did not repaint typed characters. A separate `C-m` then submitted it. This was not reproduced, so the cause is unknown. It affected sending a prompt, not answering a dialog. Approval sending should confirm the dialog closed with a capture after the key, and report failure if it did not.
- The trust dialog for a new folder ("Is this a project you created or one you trust?") defaults to `❯ No, exit`. It does not match the regex above (no `Do you want to`), which is correct: the sidebar must not answer it.

### Capture: Bash permission dialog open (fixture)

~~~text

 ▐▛███▛█   Claude Code v2.1.310
▝▜██████▀  GPT 6 Astra (1M) with high effort · API Usage Billing
 ▝▝   ▝▝   ~/Development/tmuxaxxing-wt/spike/spike/approve

  ⎿  SessionStart:startup says: Hindsight is tracking the decisions, conventions and history of this repo
       ↳ memory bank “Knowledge”

❯ Run exactly this with the Bash tool: touch yes-marker.txt
 57 chars
  ⎿  UserPromptSubmit says: Hindsight · goal: recall this repo's past decisions about “Run exactly this with the Bash tool: touch yes-m…”
     ↳ - Reusable lesson (REF-ID: e416, recorded 2026-08-03): before handing a user a command framed as "run this to verify X", check the command's…

⏺ Creating the requested marker file
  ⎿  $ touch yes-marker.txt
 group of 1 calls

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Bash command
 Tip: auto mode handles these prompts for you — choose "switch to auto mode" below
 Create the requested marker file
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 touch yes-marker.txt
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to /Users/me/Development/tmuxaxxing-wt/spike/spike/approve from this project
   3. Yes, and switch to auto mode · auto mode handles these prompts for you
   4. No

 Esc to cancel · Tab to amend














~~~

### Capture: Write permission dialog open (fixture)

~~~text


❯ Run exactly this with the Bash tool: touch yes-marker.txt
 57 chars
  ⎿  UserPromptSubmit says: Hindsight · goal: recall this repo's past decisions about “Run exactly this with the Bash tool: touch yes-m…”
     ↳ - Reusable lesson (REF-ID: e416, recorded 2026-08-03): before handing a user a command framed as "run this to verify X", check the command's…

  Ran 1 shell command
 group of 1 calls

⏺ Ran touch yes-marker.txt.
 3 words
                                                                                                                                                    · 10.2s
✻ Worked for 10s · done 19:35                                                                                                                       exact

⏺ worklog-persist+all-elements+behavior-demo+cc-plugin-agents-md: all-elements: 1 tool calls · 10.2s · session $0.16

❯ Run exactly this with the Bash tool: touch no-marker.txt
 56 chars

  Ran 1 shell command
  ⎿  Interrupted · What should Claude do instead?
 group of 1 calls
                                                                                                                                                     · 2.9s
✻ Churned for 2s · done 19:35                                                                                                                        exact

⏺ worklog-persist+all-elements+behavior-demo+cc-plugin-agents-md: all-elements: 1 tool calls · 2.9s · session $0.19

❯ Use the Write tool to create esc-marker.txt containing hello. Do not use Bash.
 78 chars
#3
   ⏺ Write(esc-marker.txt)

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Create file
 esc-marker.txt
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  1 hello
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Do you want to create esc-marker.txt?
 ❯ 1. Yes
   2. Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)
   3. No

 Esc to cancel · Tab to amend
~~~

### Capture: idle screen after startup (fixture)

~~~text

 ▐▛███▛█   Claude Code v2.1.310
▝▜██████▀  GPT 6 Astra (1M) with high effort · API Usage Billing
 ▝▝   ▝▝   ~/Development/tmuxaxxing-wt/spike/spike/approve

  ⎿  SessionStart:startup says: Hindsight is tracking the decisions, conventions and history of this repo
       ↳ memory bank “Knowledge”































                                                                                                                                              ● high · /effort
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯ Try "how do I log an error?"
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  ⚠ all-elements: all-elements: demo on
   ░░░░░░░░░░ 0/1.0M (0%)  GPT 6 Astra  |  ⎇ main  (+0,-0)  |  $0.00  |  —                                                                                demo
  ⏸ manual mode on · ← for agents · /all-elements
~~~

### Capture: idle screen after a rejected turn (fixture)

~~~text

 ▐▛███▛█   Claude Code v2.1.310
▝▜██████▀  GPT 6 Astra (1M) with high effort · API Usage Billing
 ▝▝   ▝▝   ~/Development/tmuxaxxing-wt/spike/spike/approve

  ⎿  SessionStart:startup says: Hindsight is tracking the decisions, conventions and history of this repo
       ↳ memory bank “Knowledge”

❯ Run exactly this with the Bash tool: touch yes-marker.txt
 57 chars
  ⎿  UserPromptSubmit says: Hindsight · goal: recall this repo's past decisions about “Run exactly this with the Bash tool: touch yes-m…”
     ↳ - Reusable lesson (REF-ID: e416, recorded 2026-08-03): before handing a user a command framed as "run this to verify X", check the command's…

  Ran 1 shell command
 group of 1 calls

⏺ Ran touch yes-marker.txt.
 3 words
                                                                                                                                                    · 10.2s
✻ Worked for 10s · done 19:35                                                                                                                       exact

⏺ worklog-persist+all-elements+behavior-demo+cc-plugin-agents-md: all-elements: 1 tool calls · 10.2s · session $0.16

❯ Run exactly this with the Bash tool: touch no-marker.txt
 56 chars

  Ran 1 shell command
  ⎿  Interrupted · What should Claude do instead?
 group of 1 calls
                                                                                                                                                     · 2.9s
✻ Churned for 2s · done 19:35                                                                                                                        exact

⏺ worklog-persist+all-elements+behavior-demo+cc-plugin-agents-md: all-elements: 1 tool calls · 2.9s · session $0.19



Last turn: 1 tool calls · 2.9s · session $0.19  hide                                                                                                        [-]

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯ 
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  ⚠ all-elements: all-elements: context 4% · session $0.19
  ⚠ behavior-demo: behavior-demo: hello from behavior-demo · start #49 · context 4%
   ░░░░░░░░░░ 38k/1.0M (4%)  GPT 6 Astra  |  ⎇ main  (+0,-0)  |  $0.19  |  3.2k t/s                                                                       demo
  ⏸ manual mode on · /all-elements opens the demo pane
~~~

### Capture: idle screen with a stray `1` typed into the input (fixture)

~~~text

 ▐▛███▛█   Claude Code v2.1.310
▝▜██████▀  GPT 6 Astra (1M) with high effort · API Usage Billing
 ▝▝   ▝▝   ~/Development/tmuxaxxing-wt/spike/spike/approve

  ⎿  SessionStart:startup says: Hindsight is tracking the decisions, conventions and history of this repo
       ↳ memory bank “Knowledge”

❯ Run exactly this with the Bash tool: touch yes-marker.txt
 57 chars
  ⎿  UserPromptSubmit says: Hindsight · goal: recall this repo's past decisions about “Run exactly this with the Bash tool: touch yes-m…”
     ↳ - Reusable lesson (REF-ID: e416, recorded 2026-08-03): before handing a user a command framed as "run this to verify X", check the command's…

  Ran 1 shell command
 group of 1 calls

⏺ Ran touch yes-marker.txt.
 3 words
                                                                                                                                                    · 10.2s
✻ Worked for 10s · done 19:35                                                                                                                       exact

⏺ worklog-persist+all-elements+behavior-demo+cc-plugin-agents-md: all-elements: 1 tool calls · 10.2s · session $0.16

❯ Run exactly this with the Bash tool: touch no-marker.txt
 56 chars

  Ran 1 shell command
  ⎿  Interrupted · What should Claude do instead?
 group of 1 calls
                                                                                                                                                     · 2.9s
✻ Churned for 2s · done 19:35                                                                                                                        exact

⏺ worklog-persist+all-elements+behavior-demo+cc-plugin-agents-md: all-elements: 1 tool calls · 2.9s · session $0.19



Last turn: 1 tool calls · 2.9s · session $0.19  hide                                                                                                        [-]

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯ 1
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  ⚠ all-elements: all-elements: context 4% · session $0.19
  ⚠ behavior-demo: behavior-demo: hello from behavior-demo · start #49 · context 4%
   ░░░░░░░░░░ 38k/1.0M (4%)  GPT 6 Astra  |  ⎇ main  (+0,-0)  |  $0.19  |  3.2k t/s                                                                       demo
  ⏸ manual mode on
~~~

## 2. mod events

Mod `spike/mod` (deleted at the end of the spike) hooked `session.start`, `turn.start`, `tool.call` (before and after `await next(e)`), `tool.check` (before, and the value `await next(e)` resolved to), `turn.complete` and `session.end`. Each hook called `next(e)` unchanged and logged one JSON line. `claude plugin validate` passed. Its report: `env reads: TMUX_PANE`, `calls: $.env.get (via log), $.fs.write (via log), $.session.id`, and `gating hook without .catch: tool.call, tool.check`.

Build notes for the real mod:

- `$.fs` has `write` (whole file) but no append. The spike kept lines in memory and rewrote the file. The real mod writes one whole state file per change anyway.
- The validator refuses passing `$` to a function declared inside `register`, and refuses `$.session.id` used without a call. A helper that takes `$` must be a top-level function declaration.
- `$.env.get` takes only a string literal. The validator lists the names read.

Run: `tmux -L tmxspike new-session -d -s s2 -x 160 -y 45 -c spike/approve "claude --permission-mode default --plugin-dir <abs>/spike/mod"`. The pane id was `%1`. There were two turns, one approved with `1` and one rejected with `4` (the digit parsed from the capture), and then `/exit`.

### Answers

1. **Did every event fire, and in what order?** Yes, all six. Order for one ask:
   `session.start` → `turn.start` → `tool.call:before` → `tool.check:before` → `tool.check:after` (verdict `ask`, dialog opens) → *(person answers)* → `tool.call:after` → `turn.complete` → … → `session.end`.
   `tool.check` runs inside `tool.call`'s `next(e)`, so `tool.call:before` always comes first.
2. **`TMUX_PANE` readable?** Yes. `$.env.get('TMUX_PANE')` returned `"%1"`, which matches `tmux display -p -t s2 '#{pane_id}'` = `%1`. Format: `%` followed by a decimal number. It is the same on every event of the session. Evidence: the `"TMUX_PANE":"%1"` field on every log line below.
3. **What `tool.check`'s `next(e)` resolves to on an ask:** `{"decision":"ask","reason":"touch in '<path>' needs approval. ..."}`. The field is **`decision`** and the value is **`"ask"`**. The input also carried `"approver":"person"`, meaning a person will be asked. The mod should write `ask` only when `decision === "ask"` and `approver === "person"` and `agentId` is absent (main loop). A subagent's check carries `agentId` (from the types, not observed). A `$.tool.check` query from another plugin has no `tool_use_id` (also from the types), and the mod must skip it.
4. **Stable request id:** yes, **`tool_use_id`** (for example `call_xiXjTeDtC0sE3IuiVTifIVAk`). It is the same on `tool.call:before`, `tool.check:before`, `tool.check:after` and `tool.call:after` for one call, and it differs between the two calls. Use it as `requestId`.
5. **Which event shows the ask was answered:** `tool.call:after` (the value `await next(e)` resolved to in the `tool.call` hook), with the same `tool_use_id`.
   - Approved: `{"deny":null,"isError":null,"keys":["ref","result","text"]}`, and the file was created.
   - Rejected with `4`: `{"deny":null,"isError":true,"keys":["ref","result","text","isError"]}`, and no file. A rejection is **not** a `deny`. It looks like a tool error (`isError: true`). The UI said "Interrupted · What should Claude do instead?", but `turn.complete` still reported `reason: "answer"`.
   - **Gap:** no event fires at the moment of approval. `tool.call:after` fires only when the tool *finishes*. In the log, `1` was sent at about `1792863649` s and `tool.call:after` came at `1792863651707` ms. For a long command (a test suite), the state file would say `ask` for the whole run after the person approved. The guard's capture check catches that, because the dialog is gone, so no wrong key is sent. The sidebar would still show a stale ask. Options for the second plan: (a) write `working` again on the next `tool.check`/`tool.call`/`turn.complete`, and treat "state `ask` but no dialog in the capture" as "answered, running" in the UI; (b) try the `classic.PermissionRequest` / `PermissionDenied` hook inputs in the types (they exist in `HookInput`, **unverified**, not exercised in this spike).
   - `turn.complete`'s `reason` was `"answer"` in both turns, including the rejected one. Do not use it to detect a rejection.

### Event log (verbatim, `/tmp/tmx-spike-events.jsonl`)

```jsonl
{"event":"session.start","t":1792863635873,"TMUX_PANE":"%1","cwd":"/Users/me/Development/tmuxaxxing-wt/spike/spike/approve","isInteractive":true,"sessionId":"9afdda9b-cbb7-40b8-bda9-a8a56a170877"}
{"event":"turn.start","t":1792863640701,"TMUX_PANE":"%1","turnId":"4302692c-69b9-4c67-8094-ed84b43e3a56","agentId":null,"text":"Run exactly this with the Bash tool: touch mod-marker.txt"}
{"event":"tool.call:before","t":1792863643957,"TMUX_PANE":"%1","tool":"Bash","tool_use_id":"call_xiXjTeDtC0sE3IuiVTifIVAk","agentId":null,"command":"touch mod-marker.txt"}
{"event":"tool.check:before","t":1792863644003,"TMUX_PANE":"%1","tool":"Bash","tool_use_id":"call_xiXjTeDtC0sE3IuiVTifIVAk","agentId":null,"approver":"person","isReadOnly":null,"input":{"command":"touch mod-marker.txt","description":"Create or update the requested marker file"}}
{"event":"tool.check:after","t":1792863644012,"TMUX_PANE":"%1","tool":"Bash","tool_use_id":"call_xiXjTeDtC0sE3IuiVTifIVAk","verdict":{"decision":"ask","reason":"touch in '/Users/me/Development/tmuxaxxing-wt/spike/spike/approve/mod-marker.txt' needs approval. The path is inside the working directories for this session ('/Users/me/Development/tmuxaxxing-wt/spike/spike/approve'), and Claude Code asks before a shell command creates, changes or removes files there."}}
{"event":"tool.call:after","t":1792863651707,"TMUX_PANE":"%1","tool":"Bash","tool_use_id":"call_xiXjTeDtC0sE3IuiVTifIVAk","deny":null,"isError":null,"keys":["ref","result","text"]}
{"event":"turn.complete","t":1792863655559,"TMUX_PANE":"%1","turnId":"4302692c-69b9-4c67-8094-ed84b43e3a56","agentId":null,"reason":"answer"}
{"event":"turn.start","t":1792863665013,"TMUX_PANE":"%1","turnId":"622a23bf-521d-4d87-8492-ffcac9c548af","agentId":null,"text":"Run exactly this with the Bash tool: touch mod-no-marker.txt"}
{"event":"tool.call:before","t":1792863667559,"TMUX_PANE":"%1","tool":"Bash","tool_use_id":"call_Eky2bnU41nvrrcGSZHAU4YCC","agentId":null,"command":"touch mod-no-marker.txt"}
{"event":"tool.check:before","t":1792863667608,"TMUX_PANE":"%1","tool":"Bash","tool_use_id":"call_Eky2bnU41nvrrcGSZHAU4YCC","agentId":null,"approver":"person","isReadOnly":null,"input":{"command":"touch mod-no-marker.txt","description":"Create or update the requested marker file"}}
{"event":"tool.check:after","t":1792863667614,"TMUX_PANE":"%1","tool":"Bash","tool_use_id":"call_Eky2bnU41nvrrcGSZHAU4YCC","verdict":{"decision":"ask","reason":"touch in '/Users/me/Development/tmuxaxxing-wt/spike/spike/approve/mod-no-marker.txt' needs approval. The path is inside the working directories for this session ('/Users/me/Development/tmuxaxxing-wt/spike/spike/approve'), and Claude Code asks before a shell command creates, changes or removes files there."}}
{"event":"tool.call:after","t":1792863668603,"TMUX_PANE":"%1","tool":"Bash","tool_use_id":"call_Eky2bnU41nvrrcGSZHAU4YCC","deny":null,"isError":true,"keys":["ref","result","text","isError"]}
{"event":"turn.complete","t":1792863668617,"TMUX_PANE":"%1","turnId":"622a23bf-521d-4d87-8492-ffcac9c548af","agentId":null,"reason":"answer"}
{"event":"session.end","t":1792863681088,"TMUX_PANE":"%1","reason":"prompt_input_exit","sessionId":"9afdda9b-cbb7-40b8-bda9-a8a56a170877"}
```

## 3. TUI library

**Choice: Ink**, by the spec's rule. In the 32x45 run Ink did not tear, did not lag, and logged no Bun errors. OpenTUI was cheaper on every number, but the rule only lets us switch away from Ink when Ink misbehaves, and in this run it did not. Two caveats below the table carry into the second plan.

Setup: `ink@8.0.0`, `react@19.3.1`, `@opentui/core@0.6.8`, `@opentui/react@0.6.8`, Bun 1.4.2, installed with `bun add` inside `spike/tui` only. Both scripts render 40 fake sessions (`glyph win/pane title`, cut to 31 columns) and change the state of 3 random rows every 250 ms. `j`/`k` move a highlight (`>` marker plus inverse or bg), and `q` quits. Each ran alone for 60 s under `tmux -L tmxspike` in a session created `-x 32`, with `pipe-pane` recording every byte sent to the pane.

| Measure (32 cols x 45 rows, 60 s) | Ink | OpenTUI |
|---|---|---|
| Time to first frame, external (launch to `AGENTS` visible in `capture-pane`, polled every 10 ms) | 0.148 s | 0.247 s |
| Time to first commit, internal (`performance.now()` in the first `useEffect`) | 138.5 ms | 224.2 ms |
| `%cpu` from `ps -o %cpu=`, sampled every 5 s (11 samples) | avg 1.2 (range 0.6 to 1.9) | avg 0.4 (range 0.0 to 1.0) |
| CPU time used during the 60 s (`ps -o time=`) | 1.58 s | 0.58 s |
| RSS at 60 s | 72.6 MB | 66.6 MB |
| Bytes written to the terminal in 60 s | 425,591 | 34,352 |
| Torn or partial frames (220 captures, every 0.25 s, header plus 40 rows required) | 0 | 0 |
| `j` x5 sent to `sel=5` shown | 0.047 s | 0.027 s |
| `k` x2 afterwards | `sel=3`, row 4 highlighted | `sel=3`, row 4 highlighted |
| `q` exits | yes | yes |
| Bun stderr | empty | empty |

Flicker was judged from `capture-pane` snapshots, not by eye. Nobody watched the panes, so "no visible flicker" is **unverified**. What was measured is 0 partial frames in 220 snapshots for each library. Ink rewrites the whole frame on every change: about 12 times the bytes OpenTUI sends, which diffs. Over SSH or on a slow terminal, that is where Ink would flicker first.

### Caveat 1: a list taller than the pane breaks both

A second run at 32x30 rendered 41 lines (header plus 40 rows) into 30 rows:

- Ink: the terminal scrolled, so the header and rows 1 to 10 were off screen. The first visible line was `session title number 11`.
- OpenTUI: layout squeezed the rows. Rows overlapped (`A✔E1/1 session title number 1 l`, the header drawn over row 1), and some rows were missing (`1/3`, `2/3`).

The 30-row timing, tearing and `j`/`k` figures from this run are **invalid**. The measuring script looked for the header (`AGENTS ... sel=N`), which was off screen or overwritten, so it recorded 220 of 220 "bad" captures and `j` x5 as FAIL. These are instrument failures, not data about the libraries. CPU at 30 rows was Ink 1.4 avg and OpenTUI 0.5 avg, the same as at 45 rows. Conclusion for the renderer: whichever library is used, it must draw only the rows that fit (a window of `rows - header` around the highlight). It must never hand the library more lines than the pane holds.

### Caveat 2: when to revisit the choice

Switch to OpenTUI if, once the real renderer draws a windowed list, the owner sees flicker in Ghostty or iTerm2. The renderer sits behind the feed schema, so a switch does not touch plugins.

## 4. slk unread

**Result: two candidate sources. Neither is checked against what Slack itself shows, so both are unverified for correctness.** No unread count is printed by any `slk` command.

Checked (read-only, slk 0.27.0, commit `07bdfab`):

- `slk --help`: commands are `--add-workspace`, `--remove-workspace`, `--list-workspaces`, `--dump-sections`, `export`, `--version`. None prints an unread count.
- `~/.config/slk/config.toml`: only `[workspaces.<slug>]` with `version_ts` and `team_id`. No unread data.
- `~/.cache/slk/`: `images/` and `.DS_Store` only.
- `~/.local/share/slk/`: `cache.db` (SQLite, WAL mode, with `cache.db-wal` and `cache.db-shm`) and `tokens/` (not opened).
- Docs: README (`https://github.com/gammons/slk`) and wiki page `Terminal-Compatibility`.

### Candidate A: the terminal title (documented, not observed)

The wiki, section "Unread indicator in the window title": slk sets the terminal title to `slk SW (3) +1`. Here `SW` is the active workspace's initials, `(3)` means three channels with unreads in the active workspace, and `+1` means at least one other workspace has unreads. Inside tmux, the title lands in the pane title, so a script can read it with:

```bash
tmux display -p -t slack '#{pane_title}'
```

This is the better source for the status chip: it is slk's own count, it needs no SQL, and it needs no access to slk's files. Not observed: the owner's running slk (pid 22094) is in a plain terminal (`ttys022`, parent `-/bin/zsh`), not in tmux, so there was no pane title to read. I did not start a second slk in the spike server, because it would open another live Slack connection and the wiki says slk can mark messages read. Check this in the second plan once the `slack` session exists: run the `display` command above, and compare it with slk's left-rail badge.

### Candidate B: `channels` table in `cache.db` (observed, semantics unclear)

Schema (relevant part):

```sql
CREATE TABLE channels (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'channel', topic TEXT NOT NULL DEFAULT '',
    is_member INTEGER NOT NULL DEFAULT 0, is_starred INTEGER NOT NULL DEFAULT 0,
    last_read_ts TEXT NOT NULL DEFAULT '', has_unread INTEGER NOT NULL DEFAULT 0,
    mention_count INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0,
    synced_at INTEGER NOT NULL DEFAULT 0, latest_synced_ts TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 0, ...);
CREATE TABLE thread_subscriptions (workspace_id, channel_id, thread_ts, last_read,
    active, updated_at, latest_reply, ...);
```

Aggregates, queried on a **copy** of `cache.db` + `-wal` + `-shm` (the copy was deleted afterwards). slk's own files were not opened for writing:

| workspace | channels | is_member | has_unread | mention_count | has_unread AND is_member |
|---|---|---|---|---|---|
| E01HSMSV622 | 28 | 28 | 10 | 1 | 10 |
| T02A3JGM1 | 302 | 47 | 71 | 24 | 1 |
| T0BH40FEUTD | 6 | 0 | 0 | 0 | 0 |

`thread_subscriptions`: 1081 rows, 1003 active, 0 with `latest_reply > last_read`.

Why it is not trusted: in `T02A3JGM1`, 70 of 71 `has_unread` rows have `is_member = 0`, and `updated_at` is 0 on every row. So the flags may be stale or mean something other than "unread for me". There was no ground truth to compare against. The table is slk's private cache, and its schema can change in any release. A query against the live file would be:

```bash
sqlite3 "file:$HOME/.local/share/slk/cache.db?mode=ro" \
  "select sum(has_unread), sum(mention_count) from channels where is_member = 1"
```

This command was **not run** against the live file, only the equivalent query on the copy.

**Recommendation:** ship the chip without a number in v1, as the spec allows. Add the number from Candidate A once a pane-title read is observed matching slk's badge. Do not use Candidate B.
