import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildInbox, markSeen, readSeen } from "../../src/agents/inbox";
import type { AgentRecord, AgentState } from "../../src/agents/state";

function rec(paneId: string, state: AgentState, updatedAt: number): AgentRecord {
  const base = { paneId, session: "s", window: "1", cwd: "/tmp", pid: 1, state, updatedAt };
  return state === "ask"
    ? { ...base, question: { requestId: `req-${paneId}`, tool: "Bash", summary: "x" } }
    : base;
}

describe("buildInbox", () => {
  test("ask is in even when seen after its update", () => {
    const r = rec("%1", "ask", 100);
    expect(buildInbox([r], new Map([["%1", 500]]))).toEqual([r]);
  });

  test("done is in when updated after the seen mark, out otherwise", () => {
    const r = rec("%1", "done", 100);
    expect(buildInbox([r], new Map([["%1", 50]]))).toEqual([r]);
    expect(buildInbox([r], new Map([["%1", 150]]))).toEqual([]);
  });

  test("done with no seen mark is in", () => {
    const r = rec("%1", "done", 100);
    expect(buildInbox([r], new Map())).toEqual([r]);
  });

  test("working and idle are never in", () => {
    expect(buildInbox([rec("%1", "working", 100), rec("%2", "idle", 100)], new Map())).toEqual([]);
  });

  test("asks first, then done, each oldest first", () => {
    const done10 = rec("%1", "done", 10);
    const ask30 = rec("%2", "ask", 30);
    const ask20 = rec("%3", "ask", 20);
    expect(buildInbox([done10, ask30, ask20], new Map())).toEqual([ask20, ask30, done10]);
  });
});

describe("seen marks", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "tmuxaxxing-seen-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("markSeen then readSeen round-trips", async () => {
    const dir = join(root, "seen");
    await markSeen(dir, "%3", 1234);
    await markSeen(dir, "%4", 99);
    expect(await readSeen(dir)).toEqual(new Map([["%3", 1234], ["%4", 99]]));
  });

  test("missing seen dir reads as empty", async () => {
    expect(await readSeen(join(root, "seen"))).toEqual(new Map());
  });

  test("an unparsable seen file is treated as not seen", async () => {
    const dir = join(root, "seen");
    await mkdir(dir);
    await writeFile(join(dir, "%3"), "garbage");
    await markSeen(dir, "%4", 7);
    const seen = await readSeen(dir);
    expect(seen.has("%3")).toBe(false);
    expect(seen.get("%4")).toBe(7);
  });
});
