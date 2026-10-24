import { join } from "node:path";

import { markSeen } from "../agents/inbox";
import { stateDir } from "../paths";

export async function seen(args: string[]): Promise<void> {
  const [paneId] = args;
  // The pane id becomes a file name, so accept only tmux's own %N form.
  if (args.length !== 1 || !paneId || !/^%\d+$/.test(paneId)) throw new Error("usage: seen <paneId>");
  await markSeen(join(stateDir(), "seen"), paneId, Date.now());
}
