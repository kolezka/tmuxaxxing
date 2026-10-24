import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
  test("includes zero totals for empty sections", () => {
    const feed = mapPrsToFeed(
      { review: [], mine: [], assigned: [], totals: { review: 0, mine: 0, assigned: 0 } },
      now,
    );

    expect(feed.sections).toEqual([
      { title: "REVIEW REQUESTS (0)", items: [] },
      { title: "MY OPEN PRS (0)", items: [] },
      { title: "ASSIGNED TO ME (0)", items: [] },
    ]);
  });

  test("includes fetched and total counts when results are truncated", () => {
    const feed = mapPrsToFeed(
      {
        review: Array.from({ length: 100 }, (_, index) => pr({ number: index + 1 })),
        mine: [],
        assigned: [],
        totals: { review: 132, mine: 0, assigned: 0 },
      },
      now,
    );

    expect(feed.sections[0]?.title).toBe("REVIEW REQUESTS (100 of 132)");
    expect(feed.sections[0]?.items).toHaveLength(100);
  });

  test("maps a review request with its author and relative age", () => {
    const feed = mapPrsToFeed(
      { review: [pr()], mine: [], assigned: [], totals: { review: 1, mine: 0, assigned: 0 } },
      now,
    );

    expect(feed.sections[0]?.title).toBe("REVIEW REQUESTS (1)");
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
        totals: { review: 0, mine: 2, assigned: 0 },
      },
      now,
    );

    expect(feed.sections[1]?.items[0]).toMatchObject({ icon: "✘", color: "error" });
    expect(feed.sections[1]?.items[1]).toMatchObject({ icon: "◌", color: "dim" });
  });

  test("produces JSON accepted by the feed schema", () => {
    const feed = mapPrsToFeed(
      { review: [pr()], mine: [], assigned: [], totals: { review: 1, mine: 0, assigned: 0 } },
      now,
    );
    const result = parseFeed(JSON.stringify(feed));

    expect(result.ok).toBe(true);
  });
});

test("reads issue counts from each GraphQL search", () => {
  const root = join(import.meta.dir, "../..");
  const fixtureDir = mkdtempSync(join(tmpdir(), "tmuxaxxing-gh-prs-"));
  const queryLog = join(fixtureDir, "query-fields");
  const fakeGh = join(fixtureDir, "gh");

  writeFileSync(
    fakeGh,
    `#!/bin/sh
case "$4" in
  *issueCount*) printf '%s\\n' yes >> "$GH_QUERY_LOG" ;;
  *) printf '%s\\n' no >> "$GH_QUERY_LOG" ;;
esac
case "$6" in
  *review-requested*) total=2 ;;
  *author:@me*) total=132 ;;
  *assignee:@me*) total=0 ;;
  *) printf '%s\\n' "unexpected query" >&2; exit 2 ;;
esac
printf '{"data":{"search":{"issueCount":%s,"nodes":[]}}}\\n' "$total"
`,
    { mode: 0o755 },
  );

  try {
    const result = Bun.spawnSync(["bun", "./feed.ts"], {
      cwd: join(root, "plugins/github-prs"),
      env: {
        ...process.env,
        GH_QUERY_LOG: queryLog,
        PATH: `${fixtureDir}:${process.env.PATH ?? ""}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const feed = JSON.parse(outputOf(result)) as { sections: Array<{ title: string }> };
    expect(feed.sections.map((section) => section.title)).toEqual([
      "REVIEW REQUESTS (0 of 2)",
      "MY OPEN PRS (0 of 132)",
      "ASSIGNED TO ME (0)",
    ]);
    expect(readFileSync(queryLog, "utf8")).toBe("yes\nyes\nyes\n");
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
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
