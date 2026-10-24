import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";

import { createTmux, isPidAlive, livenessFrom, type PaneInfo, type Tmux } from "../../src/tmux/tmux";

// An isolated server, so nothing here touches the owner's tmux.
const socket = `tmxtest-${crypto.randomUUID().slice(0, 8)}`;
let tmux: Tmux;
let paneId: string;

async function waitFor(check: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(50);
  }
  throw new Error("condition not met in time");
}

beforeAll(async () => {
  tmux = createTmux({ socket });
  paneId = (
    await tmux.run([
      "-f",
      "/dev/null",
      "new-session",
      "-d",
      "-s",
      "tmxtest",
      "-n",
      "work",
      "-x",
      "100",
      "-y",
      "20",
      "-P",
      "-F",
      "#{pane_id}",
      "/bin/sh",
    ])
  ).trim();
});

afterAll(async () => {
  const socketPath = (await tmux.run(["display", "-p", "#{socket_path}"])).trim();
  await tmux.run(["kill-server"]);
  // tmux leaves the socket file behind after kill-server.
  if (socketPath.includes(socket)) rmSync(socketPath, { force: true });
});

describe("createTmux against an isolated server", () => {
  test("listPanes returns the created pane with its pid", async () => {
    const panes = await tmux.listPanes();
    const pane = panes.find((p) => p.paneId === paneId);
    expect(pane).toBeDefined();
    expect(pane!.session).toBe("tmxtest");
    expect(pane!.window).toBe("work");
    expect(pane!.windowId).toMatch(/^@\d+$/);
    expect(pane!.pid).toBeGreaterThan(0);
    expect(isPidAlive(pane!.pid)).toBe(true);
    expect(pane!.slot).toBeNull();
  });

  test("sendKeys then capturePane shows the typed text", async () => {
    await tmux.sendKeys(paneId, ["echo tmx-typed-$((40+2))", "Enter"]);
    await waitFor(async () => (await tmux.capturePane(paneId)).includes("tmx-typed-42"));
    expect(await tmux.capturePane(paneId)).toContain("tmx-typed-42");
  });

  test("@tmuxaxxing_slot set with set-option -p comes back as slot", async () => {
    await tmux.run(["set-option", "-p", "-t", paneId, "@tmuxaxxing_slot", "agents"]);
    const pane = (await tmux.listPanes()).find((p) => p.paneId === paneId);
    expect(pane!.slot).toBe("agents");
  });

  test("run rejects with tmux's error on a failing command", async () => {
    await expect(tmux.run(["has-session", "-t", "no-such-session"])).rejects.toThrow(/can't find session/);
  });
});

describe("isPidAlive and livenessFrom", () => {
  test("own pid is alive, an exited child is not", async () => {
    expect(isPidAlive(process.pid)).toBe(true);
    const child = Bun.spawn(["/usr/bin/true"]);
    await child.exited;
    expect(isPidAlive(child.pid)).toBe(false);
  });

  test("livenessFrom collects pane ids", () => {
    const panes: PaneInfo[] = [
      { paneId: "%1", pid: 1, session: "s", window: "w", windowId: "@1", slot: null },
      { paneId: "%7", pid: 2, session: "s", window: "w", windowId: "@1", slot: "feed" },
    ];
    const live = livenessFrom(panes);
    expect([...live.panes].sort()).toEqual(["%1", "%7"]);
    expect(live.isPidAlive(process.pid)).toBe(true);
  });
});
