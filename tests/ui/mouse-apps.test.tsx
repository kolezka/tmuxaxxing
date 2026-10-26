import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { render } from "ink-testing-library";
import React from "react";

import type { ResolvedSlot } from "../../src/config/plugins";
import type { FeedView } from "../../src/feed/runner";
import type { FeedItem } from "../../src/feed/schema";
import { FeedPanel } from "../../src/ui/FeedPanel";
import { MouseProvider, type MouseEvent } from "../../src/ui/mouse";
import { SlotApp, tabLine } from "../../src/ui/SlotApp";

function click(x: number, y: number): MouseEvent {
  return { button: "left", x, y, pressed: true, shift: false, meta: false, ctrl: false };
}

function wheel(direction: "wheel-up" | "wheel-down"): MouseEvent {
  return { button: direction, x: 1, y: 1, pressed: true, shift: false, meta: false, ctrl: false };
}

function view(items: FeedItem[], title = "REVIEW REQUESTS"): FeedView {
  return { feed: { sections: [{ title, items }] }, error: null, stale: false, fetchedAt: 1 };
}

const items: FeedItem[] = [
  { id: "a", text: "One", action: "open one" },
  { id: "b", text: "Two", action: "open two" },
  { id: "c", text: "Three", action: "open three" },
];

describe("FeedPanel mouse", () => {
  test("a click on an item row selects it and runs its action", async () => {
    const mouse = new EventEmitter();
    const actions: FeedItem[] = [];
    const app = render(
      <MouseProvider source={mouse}>
        <FeedPanel view={view(items)} width={36} height={12} onAction={(item) => actions.push(item)} onRefresh={() => {}} />
      </MouseProvider>,
    );

    // Row 1 is the section title, rows 2 to 4 are the items.
    mouse.emit("mouse", click(5, 3));
    await Bun.sleep(0);

    expect(actions).toEqual([items[1]]);
    expect(app.lastFrame()).toContain("> Two");
    app.unmount();
  });

  test("a click on a section title or the hint does nothing", async () => {
    const mouse = new EventEmitter();
    const actions: FeedItem[] = [];
    render(
      <MouseProvider source={mouse}>
        <FeedPanel view={view(items)} width={36} height={12} onAction={(item) => actions.push(item)} onRefresh={() => {}} />
      </MouseProvider>,
    );

    mouse.emit("mouse", click(1, 1));
    mouse.emit("mouse", click(1, 5));
    mouse.emit("mouse", { ...click(1, 2), pressed: false });
    await Bun.sleep(0);

    expect(actions).toEqual([]);
  });

  test("the wheel moves the selection without running anything", async () => {
    const mouse = new EventEmitter();
    const actions: FeedItem[] = [];
    const app = render(
      <MouseProvider source={mouse}>
        <FeedPanel view={view(items)} width={36} height={12} onAction={(item) => actions.push(item)} onRefresh={() => {}} />
      </MouseProvider>,
    );

    mouse.emit("mouse", wheel("wheel-down"));
    mouse.emit("mouse", wheel("wheel-down"));
    mouse.emit("mouse", wheel("wheel-up"));
    await Bun.sleep(0);

    expect(app.lastFrame()).toContain("> Two");
    expect(actions).toEqual([]);
    app.unmount();
  });

  test("a click honours the rows the parent drew above the panel and the scroll window", async () => {
    const mouse = new EventEmitter();
    const many = Array.from({ length: 40 }, (_, index) => ({ id: `i${index}`, text: `Item ${index}`, action: "x" }));
    const actions: FeedItem[] = [];
    const app = render(
      <MouseProvider source={mouse}>
        <FeedPanel view={view(many)} width={36} height={10} top={2} onAction={(item) => actions.push(item)} onRefresh={() => {}} />
      </MouseProvider>,
    );
    app.stdin.write("j".repeat(30));
    await Bun.sleep(0);
    const rows = (app.lastFrame() ?? "").split("\n");
    // Parent rows 1 and 2, title on row 3, first visible item on row 4.
    const firstVisible = rows[1]?.trim().replace(/^> /, "") ?? "";

    mouse.emit("mouse", click(3, 4));
    await Bun.sleep(0);

    expect(actions.map((item) => item.text)).toEqual([firstVisible]);
    app.unmount();
  });

  test("keeps the hint and never draws more rows than its height", async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ id: `i${index}`, text: `Item ${index}` }));
    const app = render(<FeedPanel view={view(many)} width={36} height={12} onAction={() => {}} onRefresh={() => {}} />);
    app.stdin.write("j".repeat(30));
    await Bun.sleep(0);

    const rows = (app.lastFrame() ?? "").split("\n");
    expect(rows).toHaveLength(12);
    expect(rows[11]).toContain("click/⏎ open");
    app.unmount();
  });
});

describe("SlotApp mouse", () => {
  const slot: ResolvedSlot = {
    width: 36,
    entries: [
      { ok: true, plugin: { name: "first", kind: "feed", command: "first", dir: "/tmp", refreshMs: null } },
      { ok: true, plugin: { name: "second", kind: "feed", command: "second", dir: "/tmp", refreshMs: null } },
    ],
  };

  test("tabLine reports the column span of each label", () => {
    expect(tabLine(["first", "second"], 0)).toEqual({
      text: "[first] second",
      spans: [
        { start: 1, end: 7 },
        { start: 9, end: 14 },
      ],
    });
  });

  test("a click on a tab name switches the feed and the frame fits the height", async () => {
    const mouse = new EventEmitter();
    const actions: string[] = [];
    const app = render(
      <MouseProvider source={mouse}>
        <SlotApp
          slot={slot}
          width={36}
          height={8}
          loadFeed={async (plugin) =>
            view(
              Array.from({ length: 20 }, (_, index) => ({ id: `${plugin.name}${index}`, text: `${plugin.name} ${index}`, action: plugin.name })),
              plugin.name.toUpperCase(),
            )
          }
          runAction={(cmd) => actions.push(cmd)}
        />
      </MouseProvider>,
    );
    await Bun.sleep(0);
    expect(app.lastFrame()).toContain("FIRST");

    mouse.emit("mouse", click(10, 1));
    await Bun.sleep(20);
    expect(app.lastFrame()).toContain("SECOND");
    expect((app.lastFrame() ?? "").split("\n").length).toBeLessThanOrEqual(8);

    // Row 1 tabs, row 2 the section title, row 3 the first item.
    mouse.emit("mouse", click(4, 3));
    await Bun.sleep(20);
    expect(actions).toEqual(["second"]);
    app.unmount();
  });
});
