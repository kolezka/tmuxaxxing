import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseAgentRecord,
  readAgentDir,
  type AgentRecord,
  type Liveness,
} from "../../src/agents/state";

const baseRecord: AgentRecord = {
  paneId: "%3",
  session: "work",
  window: "1",
  cwd: "/tmp/project",
  pid: 4242,
  state: "working",
  updatedAt: 1000,
};

const askRecord: AgentRecord = {
  ...baseRecord,
  state: "ask",
  question: {
    requestId: "call_xiXjTeDtC0sE3IuiVTifIVAk",
    tool: "Bash",
    summary: "touch yes-marker.txt",
  },
};

function liveness(panes: string[], alive: (pid: number) => boolean = () => true): Liveness {
  return { panes: new Set(panes), isPidAlive: alive };
}

let root: string;
let dir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tmuxaxxing-state-"));
  dir = join(root, "agents");
  await mkdir(dir);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(name: string, body: string): Promise<void> {
  await writeFile(join(dir, name), body);
}

describe("parseAgentRecord", () => {
  test("accepts a valid ask record with its question", () => {
    expect(parseAgentRecord(JSON.stringify(askRecord))).toEqual(askRecord);
  });

  test("rejects a question on a non-ask state", () => {
    expect(() => parseAgentRecord(JSON.stringify({ ...baseRecord, question: askRecord.question }))).toThrow();
  });
});

describe("readAgentDir", () => {
  test("missing directory returns no entries", async () => {
    expect(await readAgentDir(join(root, "nope"), liveness(["%3"]))).toEqual([]);
  });

  test("empty directory returns no entries", async () => {
    expect(await readAgentDir(dir, liveness(["%3"]))).toEqual([]);
  });

  test("valid file for a live pane and pid returns the record", async () => {
    await put("%3.json", JSON.stringify(baseRecord));
    const entries = await readAgentDir(dir, liveness(["%3"]));
    expect(entries).toEqual([{ ok: true, file: join(dir, "%3.json"), record: baseRecord }]);
  });

  test("truncated file is an error entry naming the file", async () => {
    await put("%3.json", '{"paneId":"%3","sta');
    const entries = await readAgentDir(dir, liveness([]));
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry!.ok).toBe(false);
    expect(entry!.file.endsWith("%3.json")).toBe(true);
    if (!entry!.ok) {
      expect(entry!.error).toContain("invalid");
      expect(entry!.error).toContain("%3.json");
    }
  });

  test("ask without question is an error entry", async () => {
    await put("%3.json", JSON.stringify({ ...baseRecord, state: "ask" }));
    const entries = await readAgentDir(dir, liveness(["%3"]));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.ok).toBe(false);
  });

  test("record for a pane that is not live is dropped", async () => {
    await put("%9.json", JSON.stringify({ ...baseRecord, paneId: "%9" }));
    expect(await readAgentDir(dir, liveness(["%3"]))).toEqual([]);
  });

  test("record whose pid is dead is dropped even if the pane is live", async () => {
    await put("%3.json", JSON.stringify(baseRecord));
    const seen: number[] = [];
    const entries = await readAgentDir(dir, liveness(["%3"], (pid) => {
      seen.push(pid);
      return false;
    }));
    expect(entries).toEqual([]);
    expect(seen).toEqual([4242]);
  });

  test("valid and malformed files in one dir are both returned", async () => {
    await put("%3.json", JSON.stringify(baseRecord));
    await put("%4.json", "not json");
    const entries = await readAgentDir(dir, liveness(["%3"]));
    expect(entries).toHaveLength(2);
    expect(entries.filter((e) => e.ok)).toHaveLength(1);
    expect(entries.filter((e) => !e.ok).map((e) => e.file)).toEqual([join(dir, "%4.json")]);
  });

  test("entries are sorted by session, window, then pane", async () => {
    const records: AgentRecord[] = [
      { ...baseRecord, paneId: "%5", session: "b", window: "1" },
      { ...baseRecord, paneId: "%2", session: "a", window: "2" },
      { ...baseRecord, paneId: "%7", session: "a", window: "1" },
      { ...baseRecord, paneId: "%1", session: "a", window: "1" },
    ];
    for (const r of records) await put(`${r.paneId}.json`, JSON.stringify(r));
    const entries = await readAgentDir(dir, liveness(records.map((r) => r.paneId)));
    expect(entries.map((e) => (e.ok ? e.record.paneId : e.file))).toEqual(["%1", "%7", "%2", "%5"]);
  });
});
