import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";

import { FeedPanel } from "../../src/ui/FeedPanel";
import type { FeedItem } from "../../src/feed/schema";
import type { FeedView } from "../../src/feed/runner";

function view(items: FeedItem[]): FeedView {
  return {
    feed: { sections: [{ title: "REVIEW REQUESTS", items }] },
    error: null,
    stale: false,
    fetchedAt: 1,
  };
}

describe("FeedPanel", () => {
  test("keeps the section title visible alongside item 30 after scrolling", async () => {
    const items = Array.from({ length: 40 }, (_, index) => ({
      id: `item-${index}`,
      text: `Item ${index}`,
    }));
    const app = render(
      <FeedPanel
        view={view(items)}
        width={36}
        height={12}
        onAction={() => {}}
        onRefresh={() => {}}
      />,
    );

    app.stdin.write("j".repeat(30));
    await Bun.sleep(0);

    const frame = app.lastFrame() ?? "";
    expect(frame).toContain("REVIEW REQUESTS");
    expect(frame).toContain("Item 30");
    expect(frame.split("\n")).toHaveLength(12);
    app.unmount();
  });

  test("renders a stale error before the feed", () => {
    const app = render(
      <FeedPanel
        view={{ feed: null, error: "gh is unavailable", stale: true, fetchedAt: null }}
        width={36}
        height={12}
        onAction={() => {}}
        onRefresh={() => {}}
      />,
    );

    expect(app.lastFrame()).toContain("gh is unavailable");
    expect(app.lastFrame()).toContain("stale");
    app.unmount();
  });

  test("renders an empty section as none", () => {
    const app = render(
      <FeedPanel
        view={view([])}
        width={36}
        height={12}
        onAction={() => {}}
        onRefresh={() => {}}
      />,
    );

    expect(app.lastFrame()).toContain("(none)");
    app.unmount();
  });

  test("runs the action for the selected item on Enter", () => {
    const item: FeedItem = { id: "item-1", text: "One", action: "open" };
    const actions: FeedItem[] = [];
    const app = render(
      <FeedPanel
        view={view([item])}
        width={36}
        height={12}
        onAction={(selected) => actions.push(selected)}
        onRefresh={() => {}}
      />,
    );

    app.stdin.write("\r");

    expect(actions).toEqual([item]);
    app.unmount();
  });
});
