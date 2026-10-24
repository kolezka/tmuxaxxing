import { join } from "node:path";

import { buildInbox, readSeen } from "../agents/inbox";
import { readAgentDir, type AgentRecord } from "../agents/state";
import { stateDir } from "../paths";
import { createTmux, livenessFrom } from "../tmux/tmux";

function count(records: AgentRecord[], state: AgentRecord["state"]): number {
  return records.filter((record) => record.state === state).length;
}

export async function status(args: string[]): Promise<void> {
  if (args.length > 0) {
    throw new Error("usage: status");
  }

  const tmux = createTmux();
  const panes = await tmux.listPanes();
  const root = stateDir();
  const entries = await readAgentDir(join(root, "agents"), livenessFrom(panes));
  const records = entries.flatMap((entry) => (entry.ok ? [entry.record] : []));
  const seen = await readSeen(join(root, "seen"));
  const inbox = buildInbox(records, seen);
  const inboxWindows = new Set(inbox.map((record) => `${record.session}\t${record.window}`));

  for (const pane of panes) {
    const hasInbox = inboxWindows.has(`${pane.session}\t${pane.window}`);
    await tmux.run(["set-option", "-w", "-t", pane.windowId, "@tmuxaxxing_dot", hasInbox ? "1" : ""]);
  }

  console.log(
    `#[fg=yellow]✳${count(records, "working")} #[fg=magenta]✳${count(records, "ask")} #[fg=green]✳${count(records, "done")}#[default] #[range=user|slk]slk#[norange]`,
  );
}
