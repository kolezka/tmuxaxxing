import { join, resolve } from "node:path";

import { render, Text } from "ink";
import React from "react";

import { discoverPlugins, resolveSlot, type PluginDef, type ResolvedSlot } from "../config/plugins";
import { LayoutError, loadLayout } from "../config/layout";
import { getFeed, type FeedView } from "../feed/runner";
import { configDir, stateDir } from "../paths";
import { MouseProvider } from "../ui/mouse";
import { SlotApp } from "../ui/SlotApp";
import { withMouse } from "./mouse-stdin";

function parseSlot(args: string[]): "left" | "right" {
  if (args.length !== 2 || args[0] !== "--slot" || (args[1] !== "left" && args[1] !== "right")) {
    throw new Error("usage: sidebar --slot left|right");
  }

  return args[1];
}

async function renderError(message: string): Promise<void> {
  const app = render(React.createElement(Text, { color: "red" }, message));
  await app.waitUntilExit();
}

async function runTui(
  plugin: PluginDef,
  slotName: "left" | "right",
  slot: ResolvedSlot,
): Promise<void> {
  const child = Bun.spawn({
    cmd: ["/bin/sh", "-c", plugin.command],
    cwd: plugin.dir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      TMUXAXXING_SLOT: slotName,
      TMUXAXXING_WIDTH: String(slot.width),
      TMUXAXXING_STATE_DIR: stateDir(),
    },
  });

  const exitCode = await child.exited;
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

function runAction(command: string, cwd: string): void {
  Bun.spawn({
    cmd: ["/bin/sh", "-c", command],
    cwd,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
}

export async function sidebar(args: string[]): Promise<void> {
  const slotName = parseSlot(args);
  let layout;

  try {
    layout = await loadLayout(join(configDir(), "layout.toml"));
  } catch (error) {
    if (error instanceof LayoutError) {
      await renderError(error.message);
      return;
    }

    throw error;
  }

  const builtInPlugins = resolve(import.meta.dir, "../../plugins");
  const userPlugins = join(configDir(), "plugins");
  const { plugins } = await discoverPlugins([builtInPlugins, userPlugins]);
  const slot = resolveSlot(layout[slotName], plugins);
  const tuiEntries = slot.entries.filter(
    (entry): entry is { ok: true; plugin: PluginDef } => entry.ok && entry.plugin.kind === "tui",
  );

  if (slot.entries.length === 1 && tuiEntries.length === 1) {
    await runTui(tuiEntries[0].plugin, slotName, slot);
    return;
  }

  if (tuiEntries.length > 0) {
    await renderError(`tui plugin ${tuiEntries[0].plugin.name} must be alone in its slot`);
    return;
  }

  const loadFeed = (def: PluginDef, force: boolean): Promise<FeedView> =>
    getFeed(def, {
      cacheDir: join(stateDir(), "feeds"),
      now: Date.now(),
      timeoutMs: 20_000,
      force,
    });
  const mouse = withMouse();
  const app = render(
    React.createElement(
      MouseProvider,
      { source: mouse?.stdin.mouse ?? null },
      React.createElement(SlotApp, {
        slot,
        width: slot.width,
        height: process.stdout.rows ?? 24,
        loadFeed,
        runAction,
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
