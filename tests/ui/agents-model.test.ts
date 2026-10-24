import { describe, expect, test } from "bun:test";

import type { Answered } from "../../src/agents/send-approval";
import type { AgentEntry, AgentRecord } from "../../src/agents/state";
import type { PaneInfo } from "../../src/tmux/tmux";
import { buildAgentsModel, type Row } from "../../src/ui/agents/model";

function record(overrides: Partial<AgentRecord> & { paneId: string }): AgentRecord {
  return {
    session: "work",
    window: "claude",
    cwd: "/x/app",
    pid: 100,
    state: "idle",
    updatedAt: 10,
    ...overrides,
  };
}

function entry(r: AgentRecord): AgentEntry {
  return { ok: true, file: `/state/agents/${r.paneId}.json`, record: r };
}

function pane(paneId: string, overrides: Partial<PaneInfo> = {}): PaneInfo {
  return {
    paneId,
    pid: 100,
    session: "work",
    window: "claude",
    windowId: "@1",
    windowIndex: 1,
    slot: null,
    autoNamed: true,
    ...overrides,
  };
}

const ask = (paneId: string, requestId: string, updatedAt = 10) =>
  record({ paneId, state: "ask", updatedAt, question: { requestId, tool: "Bash", summary: "ls" } });

function paneIds(rows: Row[]): string[] {
  return rows.map((row) => (row.kind === "agent" ? row.record.paneId : row.file));
}

describe("buildAgentsModel", () => {
  test("an ask with an answered yes shows as running and stays out of the INBOX", () => {
    const answered = new Map<string, Answered>([["%1", { requestId: "req-1", action: "yes", at: 20 }]]);
    const model = buildAgentsModel([entry(ask("%1", "req-1"))], new Map(), answered, [pane("%1")]);

    expect(model.inbox).toEqual([]);
    const row = model.groups[0]!.rows[0]!;
    expect(row.kind === "agent" && row.display).toBe("running");
  });

  test("an answered yes for an older request leaves the new ask in the INBOX", () => {
    const answered = new Map<string, Answered>([["%1", { requestId: "req-old", action: "yes", at: 20 }]]);
    const model = buildAgentsModel([entry(ask("%1", "req-new"))], new Map(), answered, [pane("%1")]);

    expect(paneIds(model.inbox)).toEqual(["%1"]);
    const row = model.inbox[0]!;
    expect(row.kind === "agent" && row.display).toBe("ask");
  });

  test("an error entry goes to errors, not to a group", () => {
    const bad: AgentEntry = { ok: false, file: "/state/agents/%9.json", error: "%9.json: invalid JSON" };
    const model = buildAgentsModel([entry(record({ paneId: "%1" })), bad], new Map(), new Map(), [pane("%1")]);

    expect(model.errors).toEqual([{ kind: "error", file: bad.file, error: bad.error }]);
    expect(model.groups.flatMap((g) => g.rows).every((r) => r.kind === "agent")).toBe(true);
  });

  test("unseen done goes to the INBOX after asks, seen done does not", () => {
    const entries = [
      entry(record({ paneId: "%1", state: "done", updatedAt: 5 })),
      entry(record({ paneId: "%2", state: "done", updatedAt: 50 })),
      entry(ask("%3", "req-3", 90)),
    ];
    const seen = new Map([["%2", 60]]);
    const panes = [pane("%1"), pane("%2"), pane("%3")];
    const model = buildAgentsModel(entries, seen, new Map(), panes);

    expect(paneIds(model.inbox)).toEqual(["%3", "%1"]);
  });

  test("two windows both named claude are two groups labelled by cwd basename", () => {
    const entries = [
      entry(record({ paneId: "%1", cwd: "/x/api" })),
      entry(record({ paneId: "%2", cwd: "/x/web" })),
    ];
    const panes = [
      pane("%1", { windowId: "@1", windowIndex: 1 }),
      pane("%2", { windowId: "@2", windowIndex: 2 }),
    ];
    const model = buildAgentsModel(entries, new Map(), new Map(), panes);

    expect(model.groups.map((g) => g.label)).toEqual(["api", "web"]);
  });

  test("a window with its own name is labelled by that name", () => {
    const panes = [pane("%1", { window: "billing", autoNamed: false })];
    const model = buildAgentsModel([entry(record({ paneId: "%1", cwd: "/x/api" }))], new Map(), new Map(), panes);

    expect(model.groups.map((g) => g.label)).toEqual(["billing"]);
  });

  // Claude Code sets its process title to its version, so tmux auto-names the window "2.1.310".
  test("any auto-named window is labelled by cwd basename, whatever tmux called it", () => {
    const panes = [pane("%1", { window: "2.1.310", autoNamed: true })];
    const model = buildAgentsModel([entry(record({ paneId: "%1", cwd: "/x/repo" }))], new Map(), new Map(), panes);

    expect(model.groups.map((g) => g.label)).toEqual(["repo"]);
  });

  test("panes of one window share one group", () => {
    const entries = [entry(record({ paneId: "%1" })), entry(record({ paneId: "%2" }))];
    const model = buildAgentsModel(entries, new Map(), new Map(), [pane("%1"), pane("%2")]);

    expect(model.groups).toHaveLength(1);
    expect(paneIds(model.groups[0]!.rows)).toEqual(["%1", "%2"]);
  });

  test("groups are ordered by session, then window index", () => {
    const entries = [
      entry(record({ paneId: "%1", session: "work", cwd: "/x/w10" })),
      entry(record({ paneId: "%2", session: "work", cwd: "/x/w2" })),
      entry(record({ paneId: "%3", session: "alpha", cwd: "/x/a5" })),
    ];
    const panes = [
      pane("%1", { session: "work", windowId: "@10", windowIndex: 10 }),
      pane("%2", { session: "work", windowId: "@2", windowIndex: 2 }),
      pane("%3", { session: "alpha", windowId: "@5", windowIndex: 5 }),
    ];
    const model = buildAgentsModel(entries, new Map(), new Map(), panes);

    expect(model.groups.map((g) => g.label)).toEqual(["a5", "w2", "w10"]);
  });
});
