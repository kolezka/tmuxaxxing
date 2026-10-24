import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

import { createTmux, type Tmux } from "../../src/tmux/tmux";

const root = resolve(import.meta.dir, "../..");
const socket = `tmuxwiring-${crypto.randomUUID().slice(0, 8)}`;
let tmux: Tmux;
let socketPath = "";
let sequence = 0;

type SlotPane = { paneId: string; width: number; slot: string };

async function waitFor(check: () => Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(25);
  }
  throw new Error("condition not met in time");
}

async function createSession(name: string): Promise<string> {
  return (
    await tmux.run([
      "-f",
      "/dev/null",
      "new-session",
      "-d",
      "-s",
      name,
      "-x",
      "120",
      "-y",
      "30",
      "-P",
      "-F",
      "#{window_id}",
      "/bin/sh",
    ])
  ).trim();
}

async function slotPanes(windowId: string): Promise<SlotPane[]> {
  const output = await tmux.run(["list-panes", "-t", windowId, "-F", "#{pane_id}\t#{pane_width}\t#{@tmuxaxxing_slot}"]);
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [paneId, width, slot] = line.split("\t");
      return { paneId, width: Number(width), slot };
    })
    .filter((pane) => pane.slot === "left" || pane.slot === "right");
}

async function ensure(windowId: string): Promise<void> {
  try {
    await tmux.run(["run-shell", `${root}/scripts/ensure-sidebars.sh ${windowId}`]);
  } catch {
    // The pane assertions below are the contract under test.
  }
}

beforeAll(async () => {
  tmux = createTmux({ socket });
  await createSession("bootstrap");
  socketPath = (await tmux.run(["display-message", "-p", "#{socket_path}"])).trim();
  await tmux.run(["set-environment", "-g", "TMUXAXXING_ROOT", root]);
  await tmux.run(["set-environment", "-g", "TMUXAXXING_SIDEBAR_CMD", "sleep 600"]);
  await tmux.run(["source-file", resolve(root, "tmux/tmuxaxxing.tmux.conf")]);
});

afterAll(async () => {
  await tmux.run(["kill-server"]);
  rmSync(socketPath, { force: true });
});

describe("sidebar tmux wiring", () => {
  test("ensure creates one left and one right sidebar at configured widths", async () => {
    const windowId = await createSession(`work-${sequence++}`);
    await ensure(windowId);
    await waitFor(async () => (await slotPanes(windowId)).length === 2);

    const panes = await slotPanes(windowId);
    expect(panes.filter((pane) => pane.slot === "left").map((pane) => pane.width)).toEqual([32]);
    expect(panes.filter((pane) => pane.slot === "right").map((pane) => pane.width)).toEqual([36]);
  });

  test("ensuring a window twice leaves exactly two sidebar panes", async () => {
    const windowId = await createSession(`repeat-${sequence++}`);
    await ensure(windowId);
    await ensure(windowId);
    await waitFor(async () => (await slotPanes(windowId)).length === 2);

    expect(await slotPanes(windowId)).toHaveLength(2);
  });

  test("slack has no sidebars while a work session does", async () => {
    const workWindow = await createSession(`guard-${sequence++}`);
    await ensure(workWindow);
    await waitFor(async () => (await slotPanes(workWindow)).length === 2);

    const slackWindow = await createSession("slack");
    await ensure(slackWindow);
    await Bun.sleep(100);

    expect(await slotPanes(workWindow)).toHaveLength(2);
    expect(await slotPanes(slackWindow)).toHaveLength(0);
  });

  test("turning the left sidebar off removes it from every window", async () => {
    const firstWindow = await createSession(`toggle-a-${sequence++}`);
    const secondWindow = await createSession(`toggle-b-${sequence++}`);
    await ensure(firstWindow);
    await ensure(secondWindow);
    await waitFor(async () => (await slotPanes(firstWindow)).length === 2 && (await slotPanes(secondWindow)).length === 2);

    await tmux.run(["run-shell", `${root}/scripts/toggle-sidebar.sh left`]);
    await waitFor(async () => {
      const panes = [...(await slotPanes(firstWindow)), ...(await slotPanes(secondWindow))];
      return panes.every((pane) => pane.slot !== "left");
    });

    expect((await slotPanes(firstWindow)).filter((pane) => pane.slot === "left")).toHaveLength(0);
    expect((await slotPanes(secondWindow)).filter((pane) => pane.slot === "left")).toHaveLength(0);
  });
});
