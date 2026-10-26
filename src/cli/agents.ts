import { render } from "ink";
import React from "react";

import { stateDir } from "../paths";
import { createTmux } from "../tmux/tmux";
import { AgentsApp } from "../ui/agents/AgentsApp";
import { MouseProvider } from "../ui/mouse";
import { withMouse } from "./mouse-stdin";

export async function agents(args: string[]): Promise<void> {
  if (args.length > 0) throw new Error("usage: agents");

  // The sidebar passes its configured width; run by hand, use the terminal's.
  const width = Number(process.env.TMUXAXXING_WIDTH) || process.stdout.columns || 32;
  const mouse = withMouse();
  const app = render(
    React.createElement(
      MouseProvider,
      { source: mouse?.stdin.mouse ?? null },
      React.createElement(AgentsApp, {
        deps: { tmux: createTmux(), stateDir: stateDir(), now: Date.now, pollMs: 1000 },
        width,
        height: process.stdout.rows ?? 24,
      }),
    ),
    mouse ? { stdin: mouse.stdin } : undefined,
  );

  try {
    await app.waitUntilExit();
  } finally {
    mouse?.release();
  }
}
