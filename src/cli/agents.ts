import { render } from "ink";
import React from "react";

import { stateDir } from "../paths";
import { createTmux } from "../tmux/tmux";
import { AgentsApp } from "../ui/agents/AgentsApp";

export async function agents(args: string[]): Promise<void> {
  if (args.length > 0) throw new Error("usage: agents");

  // The sidebar passes its configured width; run by hand, use the terminal's.
  const width = Number(process.env.TMUXAXXING_WIDTH) || process.stdout.columns || 32;
  const app = render(
    React.createElement(AgentsApp, {
      deps: { tmux: createTmux(), stateDir: stateDir(), now: Date.now, pollMs: 1000 },
      width,
      height: process.stdout.rows ?? 24,
    }),
  );

  await app.waitUntilExit();
}
