import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ApprovalAction } from "../../src/agents/approve";
import { readAnswered, sendApproval } from "../../src/agents/send-approval";
import type { AgentRecord } from "../../src/agents/state";
import type { PaneInfo, Tmux } from "../../src/tmux/tmux";

const PANE = "%5";
const REQUEST_ID = "call_xiXjTeDtC0sE3IuiVTifIVAk";
const OTHER_REQUEST_ID = "call_Eky2bnU41nvrrcGSZHAU4YCC";
const NOW = 1_761_300_000_000;

function fixture(name: string): string {
  return readFileSync(join(import.meta.dir, "..", "fixtures", "panes", name), "utf8");
}

const bashDialog = fixture("bash-dialog.txt");
const idle = fixture("idle-startup.txt");
const bashDialogNoLineRemoved = bashDialog.replace("   4. No\n", "");

// The pid must be alive for readAgentDir to keep the record.
const askRecord: AgentRecord = {
  paneId: PANE,
  session: "s",
  window: "1",
  cwd: "/tmp",
  pid: process.pid,
  state: "ask",
  question: { requestId: REQUEST_ID, tool: "Bash", summary: "touch yes-marker.txt" },
  updatedAt: 1,
};

type FakeTmux = Tmux & { sent: { paneId: string; keys: string[] }[]; screen: string; panes: PaneInfo[] };

function fakeTmux(screen: string): FakeTmux {
  const fake: FakeTmux = {
    sent: [],
    screen,
    panes: [{ paneId: PANE, pid: process.pid, session: "s", window: "1", windowId: "@1", slot: null }],
    async listPanes() {
      return fake.panes;
    },
    async capturePane(paneId) {
      if (!fake.panes.some((p) => p.paneId === paneId)) throw new Error(`tmux: can't find pane: ${paneId}`);
      return fake.screen;
    },
    async sendKeys(paneId, keys) {
      fake.sent.push({ paneId, keys });
    },
    async jumpTo() {},
    async run() {
      return "";
    },
  };
  return fake;
}

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "tmx-send-"));
  mkdirSync(join(stateDir, "agents"));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

function writeAgent(content: string | AgentRecord): void {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  writeFileSync(join(stateDir, "agents", `${PANE}.json`), text);
}

const markerPath = () => join(stateDir, "answered", `${PANE}.json`);

function approve(tmux: Tmux, action: ApprovalAction, expectedRequestId = REQUEST_ID) {
  return sendApproval({ paneId: PANE, expectedRequestId, action }, { tmux, stateDir, now: NOW });
}

describe("sendApproval sends", () => {
  test("matching ask plus Bash dialog and no sends 4 and writes the answered marker", async () => {
    writeAgent(askRecord);
    const tmux = fakeTmux(bashDialog);

    expect(await approve(tmux, "no")).toEqual({ send: true, keys: ["4"] });
    expect(tmux.sent).toEqual([{ paneId: PANE, keys: ["4"] }]);
    expect(JSON.parse(readFileSync(markerPath(), "utf8"))).toEqual({ requestId: REQUEST_ID, action: "no", at: NOW });
    expect((await readAnswered(stateDir)).get(PANE)).toEqual({ requestId: REQUEST_ID, action: "no", at: NOW });
  });

  test("a marker for an older request does not block a new one", async () => {
    writeAgent(askRecord);
    mkdirSync(join(stateDir, "answered"));
    writeFileSync(markerPath(), JSON.stringify({ requestId: OTHER_REQUEST_ID, action: "yes", at: 1 }));
    const tmux = fakeTmux(bashDialog);

    expect(await approve(tmux, "yes")).toEqual({ send: true, keys: ["1"] });
    expect(tmux.sent).toEqual([{ paneId: PANE, keys: ["1"] }]);
    expect((await readAnswered(stateDir)).get(PANE)?.requestId).toBe(REQUEST_ID);
  });
});

describe("sendApproval refusals send nothing and write no marker", () => {
  const notAsking = (() => {
    const { question: _q, ...rest } = askRecord;
    return { ...rest, state: "working" as const };
  })();

  const cases: {
    name: string;
    reason: string;
    setup: (tmux: FakeTmux) => void;
    action: ApprovalAction;
  }[] = [
    { name: "no state file", reason: "gone", setup: () => {}, action: "yes" },
    {
      name: "pane no longer in tmux",
      reason: "gone",
      setup: (tmux) => {
        writeAgent(askRecord);
        tmux.panes = [];
      },
      action: "yes",
    },
    { name: "corrupt state file", reason: "unreadable", setup: () => writeAgent("{not json"), action: "yes" },
    { name: "agent working", reason: "not-asking", setup: () => writeAgent(notAsking), action: "yes" },
    {
      name: "different question",
      reason: "changed",
      setup: () =>
        writeAgent({ ...askRecord, question: { ...askRecord.question!, requestId: OTHER_REQUEST_ID } }),
      action: "yes",
    },
    {
      name: "idle screen",
      reason: "dialog-not-visible",
      setup: (tmux) => {
        writeAgent(askRecord);
        tmux.screen = idle;
      },
      action: "yes",
    },
    {
      name: "dialog without a No line",
      reason: "no-option-not-found",
      setup: (tmux) => {
        writeAgent(askRecord);
        tmux.screen = bashDialogNoLineRemoved;
      },
      action: "no",
    },
  ];

  for (const c of cases) {
    test(`${c.reason}: ${c.name}`, async () => {
      const tmux = fakeTmux(bashDialog);
      c.setup(tmux);

      expect(await approve(tmux, c.action)).toEqual({ send: false, reason: c.reason } as never);
      expect(tmux.sent).toEqual([]);
      expect(existsSync(markerPath())).toBe(false);
    });
  }

  test("a corrupt answered marker fails loud and sends nothing", async () => {
    writeAgent(askRecord);
    mkdirSync(join(stateDir, "answered"));
    writeFileSync(markerPath(), "{oops");
    const tmux = fakeTmux(bashDialog);

    await expect(approve(tmux, "yes")).rejects.toThrow(/answered/);
    expect(tmux.sent).toEqual([]);
  });
});

describe("Review Focus 3: the same ask approved from two sidebars", () => {
  test("the second press gives already-answered and sends nothing", async () => {
    writeAgent(askRecord);
    // The agent still reads ask and the dialog is still on screen, as right after a key press.
    const tmux = fakeTmux(bashDialog);

    expect(await approve(tmux, "yes")).toEqual({ send: true, keys: ["1"] });
    expect(tmux.sent).toHaveLength(1);
    const markerAfterFirst = readFileSync(markerPath(), "utf8");

    expect(await approve(tmux, "no")).toEqual({ send: false, reason: "already-answered" });
    expect(tmux.sent).toHaveLength(1);
    expect(readFileSync(markerPath(), "utf8")).toBe(markerAfterFirst);
  });
});

describe("readAnswered", () => {
  test("missing dir gives an empty map", async () => {
    expect((await readAnswered(stateDir)).size).toBe(0);
  });
});
