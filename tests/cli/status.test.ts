import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main } from "../../src/cli";
import { createTmux, type Tmux } from "../../src/tmux/tmux";

const socket = `tmuxstatus-${crypto.randomUUID().slice(0, 8)}`;
let tmux: Tmux;
let socketPath = "";
let stateRoot = "";
let paneId = "";
let previousSocket: string | undefined;
let previousStateDir: string | undefined;

beforeAll(async () => {
  tmux = createTmux({ socket });
  paneId = (
    await tmux.run([
      "-f",
      "/dev/null",
      "new-session",
      "-d",
      "-s",
      "status",
      "-x",
      "100",
      "-y",
      "30",
      "-P",
      "-F",
      "#{pane_id}",
      "/bin/sh",
    ])
  ).trim();
  socketPath = (await tmux.run(["display-message", "-p", "#{socket_path}"])).trim();
  const pane = (await tmux.listPanes()).find((entry) => entry.paneId === paneId)!;
  stateRoot = await mkdtemp(join(tmpdir(), "tmuxaxxing-status-"));
  const agentsDir = join(stateRoot, "agents");
  await mkdir(agentsDir);

  const states = ["working", "working", "ask", "done"] as const;
  for (const [index, state] of states.entries()) {
    await writeFile(
      join(agentsDir, `${index}.json`),
      JSON.stringify({
        paneId,
        session: pane.session,
        window: pane.window,
        cwd: "/tmp",
        pid: pane.pid,
        state,
        question: state === "ask" ? { requestId: "request-1", tool: "Bash", summary: "pwd" } : undefined,
        updatedAt: index + 1,
      }),
    );
  }

  previousSocket = process.env.TMUXAXXING_TMUX_SOCKET;
  previousStateDir = process.env.TMUXAXXING_STATE_DIR;
  process.env.TMUXAXXING_TMUX_SOCKET = socket;
  process.env.TMUXAXXING_STATE_DIR = stateRoot;
});

afterAll(async () => {
  if (previousSocket === undefined) delete process.env.TMUXAXXING_TMUX_SOCKET;
  else process.env.TMUXAXXING_TMUX_SOCKET = previousSocket;
  if (previousStateDir === undefined) delete process.env.TMUXAXXING_STATE_DIR;
  else process.env.TMUXAXXING_STATE_DIR = previousStateDir;
  await tmux.run(["kill-server"]);
  await rm(stateRoot, { recursive: true, force: true });
  await rm(socketPath, { force: true });
});

describe("status CLI", () => {
  test("prints live agent counts and marks inbox windows", async () => {
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (message: string) => output.push(message);
    try {
      await main(["status"]);
    } finally {
      console.log = originalLog;
    }

    expect(output.join("\n")).toContain("✳2");
    expect(output.join("\n")).toContain("✳1");
    expect(output.join("\n")).toContain("#[range=user|slk]slk#[norange]");
    expect(await tmux.run(["show-options", "-w", "-v", "-t", paneId, "@tmuxaxxing_dot"])).toBe("1\n");
  });
});
