import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";

import { SlotApp } from "../../src/ui/SlotApp";
import type { ResolvedSlot } from "../../src/config/plugins";
import type { FeedView } from "../../src/feed/runner";

const feedView = (title: string): FeedView => ({
  feed: { sections: [{ title, items: [{ id: title, text: title }] }] },
  error: null,
  stale: false,
  fetchedAt: 1,
});

const noAction = () => {};

async function nextFrame(): Promise<void> {
  await Bun.sleep(0);
}

describe("SlotApp", () => {
  test("renders an unresolved plugin as an error row", () => {
    const slot: ResolvedSlot = {
      width: 36,
      entries: [{ ok: false, name: "github-pr", error: "unknown plugin" }],
    };
    const app = render(
      <SlotApp
        slot={slot}
        width={36}
        height={12}
        loadFeed={async () => feedView("unused")}
        runAction={noAction}
      />,
    );

    expect(app.lastFrame()).toContain("github-pr: unknown plugin");
    app.unmount();
  });

  test("switches the rendered feed when Tab cycles two entries", async () => {
    const slot: ResolvedSlot = {
      width: 36,
      entries: [
        {
          ok: true,
          plugin: {
            name: "first",
            kind: "feed",
            command: "first",
            dir: "/tmp",
            refreshMs: null,
          },
        },
        {
          ok: true,
          plugin: {
            name: "second",
            kind: "feed",
            command: "second",
            dir: "/tmp",
            refreshMs: null,
          },
        },
      ],
    };
    const app = render(
      <SlotApp
        slot={slot}
        width={36}
        height={12}
        loadFeed={async (plugin) => feedView(plugin.name.toUpperCase())}
        runAction={noAction}
      />,
    );

    await nextFrame();
    expect(app.lastFrame()).toContain("FIRST");
    app.stdin.write("\t");
    await nextFrame();

    expect(app.lastFrame()).toContain("SECOND");
    app.unmount();
  });
});
