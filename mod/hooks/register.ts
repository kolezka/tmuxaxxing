import type { EngineInterface, Register } from "claude-code";

import { nextRecord, summaryOf, type AgentRecord, type ModEvent } from "./transitions";

// The session's state file and its last record; reset on reload, and session.start runs again then.
type Target = { file: string; record: AgentRecord | null };

let target: Target | null = null;
let queue: Promise<void> = Promise.resolve();

async function stateDir($: EngineInterface): Promise<string> {
  const override = await $.env.get("TMUXAXXING_STATE_DIR");
  if (override) return override;
  const home = await $.env.get("HOME");
  if (!home) throw new Error("HOME is not set");
  return `${home}/.cache/tmuxaxxing`;
}

async function run($: EngineInterface, argv: string[]): Promise<string> {
  const r = await $.process.run(argv);
  if (r.exitCode !== 0) throw new Error(`${argv[0]} exited ${r.exitCode}: ${r.stderr.trim()}`);
  return r.stdout;
}

async function writeRecord($: EngineInterface, file: string, record: AgentRecord): Promise<void> {
  const tmp = `${file}.tmp`;
  await $.fs.write(tmp, `${JSON.stringify(record)}\n`);
  await run($, ["mv", tmp, file]);
}

// Logs and swallows, so a mod failure never reaches the session.
async function guard($: EngineInterface, what: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    $.ui.log(`tmuxaxxing: ${what} failed: ${message}`, { to: "debug" });
  }
}

// Serialized so parallel tool calls apply in order.
function apply($: EngineInterface, ev: ModEvent): Promise<void> {
  const step = queue.then(() =>
    guard($, ev.kind, async () => {
      if (!target) return;
      const next = nextRecord(target.record, ev);
      if (next === null || next === target.record) return;
      await writeRecord($, target.file, next);
      target.record = next;
    }),
  );
  queue = step;
  return step;
}

async function startSession($: EngineInterface, cwd: string): Promise<void> {
  target = null;
  const pane = await $.env.get("TMUX_PANE");
  if (!pane) return;
  const out = await run($, ["tmux", "display", "-p", "-t", pane, "#{session_name}\t#{window_name}\t#{pane_pid}"]);
  const [session = "", window = "", pidText = ""] = out.replace(/\n$/, "").split("\t");
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`bad pane_pid from tmux: ${JSON.stringify(out)}`);
  const dir = `${await stateDir($)}/agents`;
  await run($, ["mkdir", "-p", dir]);
  target = { file: `${dir}/${pane}.json`, record: null };
  await apply($, { kind: "session.start", paneId: pane, session, window, cwd, pid, now: Date.now() });
}

async function endSession($: EngineInterface): Promise<void> {
  await queue;
  const file = target?.file;
  target = null;
  if (file) await run($, ["rm", "-f", file]);
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await guard($, "session.start", () => startSession($, e.cwd));
    return result;
  }).catch(($, e, next) => next(e));

  // Written before next so a fast turn cannot land done before working.
  on("turn.start", async ($, e, next) => {
    if (!e.agentId) await apply($, { kind: "turn.start", text: e.text, now: Date.now() });
    return next(e);
  }).catch(($, e, next) => next(e));

  on("tool.check", async ($, e, next) => {
    const verdict = await next(e);
    if (verdict.decision === "ask" && e.approver === "person" && !e.agentId && e.tool_use_id) {
      const summary = summaryOf(e.tool, e.input);
      await apply($, { kind: "ask", requestId: e.tool_use_id, tool: e.tool, summary, now: Date.now() });
    }
    return verdict;
  }).catch(($, e, next) => next(e));

  on("tool.call", async ($, e, next) => {
    const result = await next(e);
    if (!e.agentId && e.tool_use_id) await apply($, { kind: "tool.done", requestId: e.tool_use_id, now: Date.now() });
    return result;
  }).catch(($, e, next) => next(e));

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (!e.agentId) await apply($, { kind: "turn.complete", now: Date.now() });
    return result;
  }).catch(($, e, next) => next(e));

  on("session.end", async ($, e, next) => {
    await guard($, "session.end", () => endSession($));
    return next(e);
  }).catch(($, e, next) => next(e));
};
