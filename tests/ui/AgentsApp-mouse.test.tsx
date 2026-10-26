import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import React from "react";

import type { AgentRecord } from "../../src/agents/state";
import type { PaneInfo, Tmux } from "../../src/tmux/tmux";
import { AgentsApp, hintLine } from "../../src/ui/agents/AgentsApp";
import { MouseProvider, type MouseEvent } from "../../src/ui/mouse";

const NOW = 1_761_300_000_000;

type FakeTmux = Tmux & { sent: { paneId: string; keys: string[] }[]; jumps: string[] };

function fakeTmux(panes: PaneInfo[]): FakeTmux {
  const fake: FakeTmux = {
    sent: [],
    jumps: [],
    async listPanes() {
      return panes;
    },
    async capturePane() {
      return "";
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

function record(paneId: string, overrides: Partial<AgentRecord> = {}): AgentRecord {
  return { paneId, session: "work", window: "claude", cwd: `/x/proj${paneId.slice(1)}`, pid: process.pid, state: "idle", updatedAt: 10, ...overrides };
}

function paneFor(r: AgentRecord, index: number): PaneInfo {
  return { paneId: r.paneId, pid: process.pid, session: r.session, window: "claude", windowId: `@${index}`, windowIndex: index, slot: null, autoNamed: true };
}

function click(x: number, y: number): MouseEvent {
  return { button: "left", x, y, pressed: true, shift: false, meta: false, ctrl: false };
}

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "tmx-agents-mouse-"));
  mkdirSync(join(stateDir, "agents"));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

function setup(records: AgentRecord[]): FakeTmux {
  for (const r of records) writeFileSync(join(stateDir, "agents", `${r.paneId}.json`), JSON.stringify(r));
  return fakeTmux(records.map(paneFor));
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await Bun.sleep(10);
  }
  throw new Error("condition not met in time");
}

function renderApp(tmux: Tmux, mouse: EventEmitter, height = 30) {
  return render(
    <MouseProvider source={mouse}>
      <AgentsApp deps={{ tmux, stateDir, now: () => NOW, pollMs: 60_000 }} width={32} height={height} />
    </MouseProvider>,
  );
}

const doneA = record("%1", { state: "done", updatedAt: 30 });
const doneB = record("%2", { state: "done", updatedAt: 20 });

describe("AgentsApp mouse", () => {
  test("hintLine drops chips that do not fit", () => {
    expect(hintLine(32).text).toBe("y:yes  x:no  n:next  ⏎:open");
    expect(hintLine(12).text).toBe("y:yes  x:no");
    expect(hintLine(32).spans[3]).toEqual({ start: 22, end: 27, key: "\r" });
  });

  test("a click on a session row jumps to that pane", async () => {
    const mouse = new EventEmitter();
    const tmux = setup([doneA, doneB]);
    const app = renderApp(tmux, mouse);
    await waitFor(() => (app.lastFrame() ?? "").includes("proj2"));
    const rows = (app.lastFrame() ?? "").split("\n");
    const target = rows.findIndex((row) => row.includes("proj2"));
    expect(target).toBeGreaterThan(0);

    mouse.emit("mouse", click(4, target + 1));
    await waitFor(() => tmux.jumps.length > 0);

    expect(tmux.jumps).toEqual(["%2"]);
    expect(app.lastFrame()).toContain("> ✓ proj2");
    app.unmount();
  });

  test("a click on the header or an empty line does nothing", async () => {
    const mouse = new EventEmitter();
    const tmux = setup([doneA]);
    const app = renderApp(tmux, mouse);
    await waitFor(() => (app.lastFrame() ?? "").includes("proj1"));

    mouse.emit("mouse", click(1, 1));
    mouse.emit("mouse", click(1, 29));
    await Bun.sleep(30);

    expect(tmux.jumps).toEqual([]);
    app.unmount();
  });

  test("a click on the open chip presses Enter for the selected row", async () => {
    const mouse = new EventEmitter();
    const tmux = setup([doneA]);
    const app = renderApp(tmux, mouse, 12);
    await waitFor(() => (app.lastFrame() ?? "").includes("proj1"));
    const rows = (app.lastFrame() ?? "").split("\n");
    const hintRow = rows.findIndex((row) => row.includes("⏎:open")) + 1;
    expect(hintRow).toBeGreaterThan(0);
    const chip = hintLine(32).spans.find((span) => span.key === "\r")!;

    mouse.emit("mouse", click(chip.start, hintRow));
    await waitFor(() => tmux.jumps.length > 0);

    expect(tmux.jumps).toEqual(["%1"]);
    app.unmount();
  });

  test("the wheel moves the selection and the frame still fits", async () => {
    const mouse = new EventEmitter();
    const tmux = setup([doneA, doneB]);
    const app = renderApp(tmux, mouse, 12);
    await waitFor(() => (app.lastFrame() ?? "").includes("proj2"));

    mouse.emit("mouse", { ...click(1, 1), button: "wheel-down" });
    await Bun.sleep(30);

    // The INBOX lists proj2 (newer) first, so one wheel step lands on proj1.
    const frame = app.lastFrame() ?? "";
    expect(frame).toContain("> ✓ proj1");
    expect(frame.split("\n").length).toBeLessThanOrEqual(12);
    expect(tmux.jumps).toEqual([]);
    app.unmount();
  });
});
