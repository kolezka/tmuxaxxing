import { describe, expect, test } from "bun:test";

import { parseFeed } from "../../src/feed/schema";

function errorOf(result: ReturnType<typeof parseFeed>): string {
  if (result.ok) {
    throw new Error("Expected feed parsing to fail");
  }

  return result.error;
}

describe("parseFeed", () => {
  test("parses the documented Payments retry feed item", () => {
    const result = parseFeed(`{"sections":[{"title":"REVIEW REQUESTS","items":[{"id":"pr-1842","icon":"◆","color":"ask","text":"#1842 Payments retry","meta":"ania · 2h","action":"gh pr view 1842 --web"}]}]}`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.feed.sections[0]?.items[0]).toEqual({
      id: "pr-1842",
      icon: "◆",
      color: "ask",
      text: "#1842 Payments retry",
      meta: "ania · 2h",
      action: "gh pr view 1842 --web",
    });
  });

  test("returns an invalid JSON error", () => {
    expect(errorOf(parseFeed("not json"))).toContain("invalid JSON");
  });

  test("names the missing id path", () => {
    const error = errorOf(
      parseFeed('{"sections":[{"title":"X","items":[{"text":"no id"}]}]}'),
    );

    expect(error).toContain("sections.0.items.0.id");
  });

  test("accepts an empty feed", () => {
    const result = parseFeed('{"sections":[]}');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.feed.sections).toHaveLength(0);
  });

  test("rejects an unknown color", () => {
    const error = errorOf(
      parseFeed('{"sections":[{"title":"X","items":[{"id":"item","text":"Item","color":"purple"}]}]}'),
    );

    expect(error).toContain("color");
  });
});
