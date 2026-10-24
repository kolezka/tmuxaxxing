import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import React from "react";

import type { AgentRecord } from "../../src/agents/state";
import type { PaneInfo, Tmux } from "../../src/tmux/tmux";
import { AgentsApp } from "../../src/ui/agents/AgentsApp";

const NOW = 1_761_300_000_000;
const bashDialog = readFileSync(join(import.meta.dir, "..", "fixtures", "panes", "bash-dialog.txt"), "utf8");

type FakeTmux = Tmux & {
  sent: { paneId: string; keys: string[] }[];
  jumps: string[];
  panes: PaneInfo[];
};

function fakeTmux(panes: PaneInfo[]): FakeTmux {
  const fake: FakeTmux = {
    sent: [],
    jumps: [],
    panes,
    async listPanes() {
      return fake.panes;
    },
    async capturePane() {
      return bashDialog;
    },
    async sendKeys(paneId, keys) {
      fake.sent.push({ paneId, keys });
    },
    async jumpTo(paneId) {
      fake.jumps.push(paneId);
    },
    async run() {
      return "";
    },
  };
  return fake;
}

// The pid must be alive for readAgentDir to keep the record.
function record(paneId: string, overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    paneId,
    session: "work",
    window: "claude",
    cwd: `/x/proj${paneId.slice(1)}`,
    pid: process.pid,
    state: "idle",
    updatedAt: 10,
    ...overrides,
  };
}

function paneFor(r: AgentRecord, index: number): PaneInfo {
  return {
    paneId: r.paneId,
    pid: process.pid,
    session: r.session,
    window: "claude",
    windowId: `@${index}`,
    windowIndex: index,
    slot: null,
  };
}

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "tmx-agents-app-"));
  mkdirSync(join(stateDir, "agents"));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

function setup(records: AgentRecord[]): FakeTmux {
  for (const r of records) {
    writeFileSync(join(stateDir, "agents", `${r.paneId}.json`), JSON.stringify(r));
  }
  return fakeTmux(records.map(paneFor));
}

function renderApp(tmux: Tmux, height = 30) {
  return render(
    <AgentsApp deps={{ tmux, stateDir, now: () => NOW, pollMs: 60_000 }} width={32} height={height} />,
  );
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await Bun.sleep(10);
  }
  throw new Error("condition not met in time");
}

const askRecord = record("%1", {
  state: "ask",
  updatedAt: 20,
  question: { requestId: "req-1", tool: "Bash", summary: "touch yes-marker.txt" },
});
const doneRecord = record("%2", { state: "done", updatedAt: 30 });

describe("AgentsApp", () => {
  test("shows the ask in the INBOX with tool and summary", async () => {
    const tmux = setup([askRecord]);
    const app = renderApp(tmux);
    await waitFor(() => (app.lastFrame() ?? "").includes("Bash: touch yes-marker.txt"));
    expect(app.lastFrame()).toContain("INBOX");
    app.unmount();
  });

  test("y on an ask row sends 1 once", async () => {
    const tmux = setup([askRecord]);
    const app = renderApp(tmux);
    await waitFor(() => (app.lastFrame() ?? "").includes("Bash:"));

    app.stdin.write("y");
    await waitFor(() => tmux.sent.length > 0);
    await Bun.sleep(50);

    expect(tmux.sent).toEqual([{ paneId: "%1", keys: ["1"] }]);
    app.unmount();
  });

  test("x on an ask row sends the No digit from the dialog", async () => {
    const tmux = setup([askRecord]);
    const app = renderApp(tmux);
    await waitFor(() => (app.lastFrame() ?? "").includes("Bash:"));

    app.stdin.write("x");
    await waitFor(() => tmux.sent.length > 0);

    expect(tmux.sent).toEqual([{ paneId: "%1", keys: ["4"] }]);
    app.unmount();
  });

  test("y on a done row sends nothing and says not an approval", async () => {
    // The ask sits above the done row, so a y that ignored the selection would send.
    const tmux = setup([askRecord, doneRecord]);
    const app = renderApp(tmux);
    await waitFor(() => (app.lastFrame() ?? "").includes("proj2"));

    app.stdin.write("j");
    await Bun.sleep(20);
    app.stdin.write("y");
    await waitFor(() => (app.lastFrame() ?? "").includes("not an approval"));
    await Bun.sleep(50);

    expect(tmux.sent).toEqual([]);
    app.unmount();
  });

  test("a refused approval shows the inline message and sends nothing", async () => {
    const tmux = setup([askRecord]);
    const app = renderApp(tmux);
    await waitFor(() => (app.lastFrame() ?? "").includes("Bash:"));
    // The state changes after the frame was drawn: the guard must refuse.
    writeFileSync(
      join(stateDir, "agents", "%1.json"),
      JSON.stringify({ ...askRecord, question: { ...askRecord.question!, requestId: "req-2" } }),
    );

    app.stdin.write("y");
    // At 32 columns the message wraps onto two lines.
    await waitFor(() => (app.lastFrame() ?? "").replace(/\n/g, " ").includes("changed, open the session instead"));

    expect(tmux.sent).toEqual([]);
    app.unmount();
  });

  test("Enter jumps to the pane and writes the seen file", async () => {
    const tmux = setup([doneRecord]);
    const app = renderApp(tmux);
    await waitFor(() => (app.lastFrame() ?? "").includes("proj2"));

    app.stdin.write("\r");
    const seenFile = join(stateDir, "seen", "%2");
    await waitFor(() => existsSync(seenFile));

    expect(tmux.jumps).toEqual(["%2"]);
    expect(readFileSync(seenFile, "utf8")).toBe(String(NOW));
    app.unmount();
  });

  test("an unreadable state file shows as an error row", async () => {
    const tmux = setup([askRecord]);
    writeFileSync(join(stateDir, "agents", "%9.json"), "{not json");
    const app = renderApp(tmux);
    await waitFor(() => (app.lastFrame() ?? "").includes("%9.json"));
    app.unmount();
  });

  test("fifty sessions at height 15 keep INBOX in the frame after scrolling", async () => {
    const records = Array.from({ length: 50 }, (_, i) =>
      record(`%${i + 1}`, {
        state: i % 5 === 0 ? "ask" : i % 2 === 0 ? "done" : "working",
        updatedAt: i + 1,
        question: i % 5 === 0 ? { requestId: `req-${i}`, tool: "Bash", summary: `cmd ${i}` } : undefined,
      }),
    );
    const tmux = setup(records);
    const app = renderApp(tmux, 15);
    await waitFor(() => (app.lastFrame() ?? "").includes("INBOX 30"));

    app.stdin.write("j".repeat(100));
    await Bun.sleep(50);

    const frame = app.lastFrame() ?? "";
    expect(frame).toContain("INBOX");
    expect(frame).toContain("proj50");
    expect(frame.split("\n").length).toBeLessThanOrEqual(15);
    app.unmount();
  });
});
