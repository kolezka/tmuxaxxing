import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { mapPrsToFeed, type GhPr } from "../../plugins/github-prs/map";
import { parseFeed } from "../../src/feed/schema";

const now = Date.parse("2026-10-24T12:00:00.000Z");

function pr(overrides: Partial<GhPr> = {}): GhPr {
  return {
    number: 1842,
    title: "Payments retry",
    url: "https://github.com/acme/payments/pull/1842",
    repo: "acme/payments",
    author: "ania",
    updatedAt: "2026-10-24T10:00:00.000Z",
    isDraft: false,
    ci: null,
    review: null,
    ...overrides,
  };
}

function outputOf(result: Bun.SyncSubprocess): string {
  return new TextDecoder().decode(result.stdout);
}

function errorOf(result: Bun.SyncSubprocess): string {
  return new TextDecoder().decode(result.stderr);
}

describe("mapPrsToFeed", () => {
  test("always returns the three sections for empty lists", () => {
    const feed = mapPrsToFeed({ review: [], mine: [], assigned: [] }, now);

    expect(feed.sections).toEqual([
      { title: "REVIEW REQUESTS", items: [] },
      { title: "MY OPEN PRS", items: [] },
      { title: "ASSIGNED TO ME", items: [] },
    ]);
  });

  test("maps a review request with its author and relative age", () => {
    const feed = mapPrsToFeed({ review: [pr()], mine: [], assigned: [] }, now);

    expect(feed.sections[0]?.items[0]).toMatchObject({
      id: "pr-acme/payments-1842",
      text: "#1842 Payments retry",
      action: "open 'https://github.com/acme/payments/pull/1842'",
    });
    expect(feed.sections[0]?.items[0]?.meta).toContain("ania");
    expect(feed.sections[0]?.items[0]?.meta).toContain("2h");
  });

  test("maps CI failure and drafts with the required icon and color", () => {
    const feed = mapPrsToFeed(
      {
        review: [],
        mine: [pr({ ci: "fail" }), pr({ number: 1843, isDraft: true, ci: "pass" })],
        assigned: [],
      },
      now,
    );

    expect(feed.sections[1]?.items[0]).toMatchObject({ icon: "✘", color: "error" });
    expect(feed.sections[1]?.items[1]).toMatchObject({ icon: "◌", color: "dim" });
  });

  test("produces JSON accepted by the feed schema", () => {
    const feed = mapPrsToFeed({ review: [pr()], mine: [], assigned: [] }, now);
    const result = parseFeed(JSON.stringify(feed));

    expect(result.ok).toBe(true);
  });
});

test("returns gh failures through stderr without feed output", () => {
  const root = join(import.meta.dir, "../..");
  const fakeGhDir = join(root, "tests/fixtures/gh");
  const result = Bun.spawnSync(["bun", "./feed.ts"], {
    cwd: join(root, "plugins/github-prs"),
    env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH ?? ""}` },
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(1);
  expect(outputOf(result)).toBe("");
  expect(errorOf(result)).toContain("401");
});
