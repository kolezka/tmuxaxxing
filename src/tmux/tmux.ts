import type { Liveness } from "../agents/state";

export type PaneInfo = {
  paneId: string;
  pid: number;
  session: string;
  window: string;
  windowId: string;
  windowIndex: number;
  slot: string | null;
  // True while tmux names the window after its command, i.e. nobody renamed it.
  autoNamed: boolean;
};

export type Tmux = {
  listPanes(): Promise<PaneInfo[]>;
  capturePane(paneId: string): Promise<string>;
  sendKeys(paneId: string, keys: string[]): Promise<void>;
  jumpTo(paneId: string): Promise<void>;
  run(args: string[]): Promise<string>;
};

// Names can hold spaces, so fields are tab separated and window_name goes last.
const PANE_FORMAT = ["#{pane_id}", "#{pane_pid}", "#{window_id}", "#{window_index}", "#{@tmuxaxxing_slot}", "#{automatic-rename}", "#{session_name}", "#{window_name}"].join("\t");

function parsePaneLine(line: string): PaneInfo {
  const [paneId, pid, windowId, windowIndex, slot, autoRename, session, ...windowParts] = line.split("\t");
  if (!paneId || !pid || !windowId || !windowIndex || autoRename === undefined || session === undefined || windowParts.length === 0) {
    throw new Error(`tmux list-panes: unexpected line: ${JSON.stringify(line)}`);
  }
  return {
    paneId,
    pid: Number(pid),
    session,
    window: windowParts.join("\t"),
    windowId,
    windowIndex: Number(windowIndex),
    slot: slot ? slot : null,
    autoNamed: autoRename === "1",
  };
}

export function createTmux(opts: { socket?: string } = {}): Tmux {
  const socket = opts.socket ?? process.env.TMUXAXXING_TMUX_SOCKET;

  async function run(args: string[]): Promise<string> {
    const binary = Bun.which("tmux");
    if (!binary) throw new Error("tmux: binary not found on PATH");
    const cmd = socket ? [binary, "-L", socket, ...args] : [binary, ...args];
    const child = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe" });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) {
      throw new Error(`tmux ${args.join(" ")}: exit ${exitCode}: ${stderr.trim()}`);
    }
    return stdout;
  }

  return {
    run,
    async listPanes() {
      const out = await run(["list-panes", "-a", "-F", PANE_FORMAT]);
      return out
        .split("\n")
        .filter((line) => line.length > 0)
        .map(parsePaneLine);
    },
    async capturePane(paneId) {
      // Visible screen only: scrollback could hold an old dialog.
      return run(["capture-pane", "-p", "-t", paneId]);
    },
    async sendKeys(paneId, keys) {
      await run(["send-keys", "-t", paneId, ...keys]);
    },
    async jumpTo(paneId) {
      const pane = (await this.listPanes()).find((p) => p.paneId === paneId);
      if (!pane) throw new Error(`tmux: pane ${paneId} not found`);
      await run(["switch-client", "-t", pane.session]);
      await run(["select-window", "-t", pane.windowId]);
      await run(["select-pane", "-t", paneId]);
    },
  };
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function livenessFrom(panes: PaneInfo[]): Liveness {
  return { panes: new Set(panes.map((p) => p.paneId)), isPidAlive };
}
