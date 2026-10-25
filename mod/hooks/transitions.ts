// Pure state machine for the agent record. No mod API imports, so bun test can load it.
// The record shape mirrors AgentRecord in src/agents/state.ts; the tests parse every output with it.

export type AgentState = "idle" | "working" | "ask" | "done";

export type AgentQuestion = { requestId: string; tool: string; summary: string };

export type AgentRecord = {
  paneId: string;
  session: string;
  window: string;
  cwd: string;
  pid: number;
  state: AgentState;
  title?: string;
  question?: AgentQuestion;
  updatedAt: number;
};

export type ModEvent =
  | { kind: "session.start"; paneId: string; session: string; window: string; cwd: string; pid: number; now: number }
  | { kind: "turn.start"; text: string; now: number }
  | { kind: "ask"; requestId: string; tool: string; summary: string; now: number }
  | { kind: "tool.done"; requestId: string; now: number }
  | { kind: "turn.complete"; now: number };

const TITLE_MAX = 60;
const SUMMARY_MAX = 120;

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function titleOf(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return cut(line, TITLE_MAX);
}

function stringField(input: unknown, key: string): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function summaryOf(tool: string, input: unknown): string {
  const text = (tool === "Bash" ? stringField(input, "command") : undefined) ?? stringField(input, "file_path") ?? tool;
  return cut(text, SUMMARY_MAX);
}

// Drops the question so non-ask states never carry one.
function withoutQuestion(record: AgentRecord): AgentRecord {
  const { question: _dropped, ...rest } = record;
  return rest;
}

export function nextRecord(prev: AgentRecord | null, ev: ModEvent): AgentRecord | null {
  if (ev.kind === "session.start") {
    const { paneId, session, window, cwd, pid, now } = ev;
    return { paneId, session, window, cwd, pid, state: "idle", updatedAt: now };
  }
  if (prev === null) return null;

  switch (ev.kind) {
    case "turn.start":
      return { ...withoutQuestion(prev), state: "working", title: titleOf(ev.text), updatedAt: ev.now };
    case "ask":
      return {
        ...prev,
        state: "ask",
        question: { requestId: ev.requestId, tool: ev.tool, summary: ev.summary },
        updatedAt: ev.now,
      };
    case "tool.done":
      if (prev.state !== "ask" || prev.question?.requestId !== ev.requestId) return prev;
      return { ...withoutQuestion(prev), state: "working", updatedAt: ev.now };
    case "turn.complete":
      return { ...withoutQuestion(prev), state: "done", updatedAt: ev.now };
  }
}
