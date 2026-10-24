import { describe, expect, test } from "bun:test";

import { nextRecord, summaryOf, titleOf, type ModEvent } from "../../mod/hooks/transitions";
import { parseAgentRecord, type AgentRecord } from "../../src/agents/state";

const start: ModEvent = {
  kind: "session.start",
  paneId: "%1",
  session: "s1",
  window: "w1",
  cwd: "/tmp/repo",
  pid: 4242,
  now: 1,
};

// Every produced record must survive the reader's strict parser.
function valid(record: AgentRecord | null): AgentRecord {
  expect(record).not.toBeNull();
  return parseAgentRecord(JSON.stringify(record));
}

function askedRecord(): AgentRecord {
  const idle = valid(nextRecord(null, start));
  const working = valid(nextRecord(idle, { kind: "turn.start", text: "run it", now: 2 }));
  return valid(
    nextRecord(working, { kind: "ask", requestId: "call_a", tool: "Bash", summary: "touch x", now: 3 }),
  );
}

describe("nextRecord", () => {
  test("full cycle start, turn, ask, tool.done, complete", () => {
    const idle = valid(nextRecord(null, start));
    expect(idle).toEqual({
      paneId: "%1",
      session: "s1",
      window: "w1",
      cwd: "/tmp/repo",
      pid: 4242,
      state: "idle",
      updatedAt: 1,
    });

    const working = valid(nextRecord(idle, { kind: "turn.start", text: "Fix the bug\nmore", now: 2 }));
    expect(working.state).toBe("working");
    expect(working.title).toBe("Fix the bug");
    expect(working.updatedAt).toBe(2);

    const ask = valid(
      nextRecord(working, { kind: "ask", requestId: "call_a", tool: "Bash", summary: "touch x", now: 3 }),
    );
    expect(ask.state).toBe("ask");
    expect(ask.question).toEqual({ requestId: "call_a", tool: "Bash", summary: "touch x" });
    expect(ask.updatedAt).toBe(3);

    const back = valid(nextRecord(ask, { kind: "tool.done", requestId: "call_a", now: 4 }));
    expect(back.state).toBe("working");
    expect(back.question).toBeUndefined();
    expect(back.title).toBe("Fix the bug");
    expect(back.updatedAt).toBe(4);

    const done = valid(nextRecord(back, { kind: "turn.complete", now: 5 }));
    expect(done.state).toBe("done");
    expect(done.updatedAt).toBe(5);
  });

  test("tool.done with a different requestId leaves the ask unchanged", () => {
    const ask = askedRecord();
    const after = valid(nextRecord(ask, { kind: "tool.done", requestId: "call_other", now: 9 }));
    expect(after).toEqual(ask);
  });

  test("tool.done outside an ask leaves the record unchanged", () => {
    const idle = valid(nextRecord(null, start));
    const working = valid(nextRecord(idle, { kind: "turn.start", text: "go", now: 2 }));
    expect(valid(nextRecord(working, { kind: "tool.done", requestId: "call_a", now: 3 }))).toEqual(working);
  });

  test("turn.complete from ask clears question", () => {
    const done = valid(nextRecord(askedRecord(), { kind: "turn.complete", now: 7 }));
    expect(done.state).toBe("done");
    expect(done.question).toBeUndefined();
    expect("question" in done).toBe(false);
  });

  test("any event but session.start with no previous record gives null", () => {
    expect(nextRecord(null, { kind: "turn.start", text: "hi", now: 1 })).toBeNull();
    expect(nextRecord(null, { kind: "ask", requestId: "r", tool: "Bash", summary: "s", now: 1 })).toBeNull();
    expect(nextRecord(null, { kind: "tool.done", requestId: "r", now: 1 })).toBeNull();
    expect(nextRecord(null, { kind: "turn.complete", now: 1 })).toBeNull();
  });

  test("session.start over an existing record starts idle again", () => {
    const restarted = valid(nextRecord(askedRecord(), { ...start, now: 10 }));
    expect(restarted.state).toBe("idle");
    expect(restarted.question).toBeUndefined();
    expect(restarted.updatedAt).toBe(10);
  });
});

describe("titleOf", () => {
  test("cuts a 100-char line to 60 chars ending in an ellipsis", () => {
    const title = titleOf("a".repeat(100));
    expect(title.length).toBe(60);
    expect(title.endsWith("…")).toBe(true);
    expect(title).toBe(`${"a".repeat(59)}…`);
  });

  test("uses the first non-empty line, untouched when short", () => {
    expect(titleOf("\n   \n  Hello there  \nsecond")).toBe("Hello there");
    expect(titleOf("b".repeat(60))).toBe("b".repeat(60));
  });
});

describe("summaryOf", () => {
  test("Bash gives the command", () => {
    expect(summaryOf("Bash", { command: "touch x" })).toBe("touch x");
  });

  test("a file tool gives file_path", () => {
    expect(summaryOf("Write", { file_path: "/a/b" })).toBe("/a/b");
  });

  test("anything else gives the tool name", () => {
    expect(summaryOf("WebFetch", { url: "https://x" })).toBe("WebFetch");
    expect(summaryOf("Bash", null)).toBe("Bash");
  });

  test("cuts to 120 chars", () => {
    expect(summaryOf("Bash", { command: "c".repeat(300) }).length).toBe(120);
  });
});
