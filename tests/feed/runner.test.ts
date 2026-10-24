import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { PluginDef } from "../../src/config/plugins";
import { getFeed } from "../../src/feed/runner";

const fixture = join(import.meta.dir, "..", "fixtures", "feeds", "feed.sh");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeCacheDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tmuxaxxing-feed-runner-"));
  tempDirs.push(dir);
  return dir;
}

function feedPlugin(refreshMs = 1_000): PluginDef {
  return {
    name: "test-feed",
    kind: "feed",
    command: fixture,
    dir: tmpdir(),
    refreshMs,
  };
}

async function counterLines(path: string): Promise<number> {
  try {
    return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function withFixtureEnv<T>(
  values: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("getFeed", () => {
  test("returns a fresh parsed feed from a successful command", async () => {
    const cacheDir = await makeCacheDir();
    const counter = join(cacheDir, "counter");

    const view = await withFixtureEnv(
      { FEED_COUNTER_FILE: counter, FEED_MODE: "good", FEED_HOLD_LOCK: undefined },
      () => getFeed(feedPlugin(), { cacheDir, now: 1_000, timeoutMs: 500 }),
    );

    expect(view).toEqual({
      feed: { sections: [{ title: "FEED", items: [{ id: "item-1", text: "One" }] }] },
      error: null,
      stale: false,
      fetchedAt: 1_000,
    });
    expect(await counterLines(counter)).toBe(1);
  });

  test("uses a fresh cache entry without rerunning the command", async () => {
    const cacheDir = await makeCacheDir();
    const counter = join(cacheDir, "counter");

    await withFixtureEnv(
      { FEED_COUNTER_FILE: counter, FEED_MODE: "good", FEED_HOLD_LOCK: undefined },
      async () => {
        await getFeed(feedPlugin(), { cacheDir, now: 1_000, timeoutMs: 500 });
        await getFeed(feedPlugin(), { cacheDir, now: 1_500, timeoutMs: 500 });
      },
    );

    expect(await counterLines(counter)).toBe(1);
  });

  test("shares one refresh across ten concurrent readers", async () => {
    const cacheDir = await makeCacheDir();
    const counter = join(cacheDir, "counter");

    const views = await withFixtureEnv(
      { FEED_COUNTER_FILE: counter, FEED_MODE: "good", FEED_HOLD_LOCK: "1" },
      () =>
        Promise.all(
          Array.from({ length: 10 }, () =>
            getFeed(feedPlugin(), { cacheDir, now: 2_000, timeoutMs: 1_000 }),
          ),
        ),
    );

    expect(await counterLines(counter)).toBe(1);
    expect(views).toHaveLength(10);
    expect(new Set(views.map((view) => view.fetchedAt))).toEqual(new Set([2_000]));
    expect(views.every((view) => view.error === null && view.stale === false)).toBe(true);
  });

  test("preserves the last good feed as stale after a failed refresh", async () => {
    const cacheDir = await makeCacheDir();
    const counter = join(cacheDir, "counter");

    const view = await withFixtureEnv(
      { FEED_COUNTER_FILE: counter, FEED_MODE: "good", FEED_HOLD_LOCK: undefined },
      async () => {
        const first = await getFeed(feedPlugin(), { cacheDir, now: 1_000, timeoutMs: 500 });
        process.env.FEED_MODE = "fail";
        const second = await getFeed(feedPlugin(), {
          cacheDir,
          now: 2_000,
          timeoutMs: 500,
          force: true,
        });

        expect(first.feed).not.toBeNull();
        return second;
      },
    );

    expect(view.feed).toEqual({
      sections: [{ title: "FEED", items: [{ id: "item-1", text: "One" }] }],
    });
    expect(view.stale).toBe(true);
    expect(view.fetchedAt).toBe(1_000);
    expect(view.error).toContain("not logged in");
  });

  test("returns an error for invalid feed JSON without inventing an empty feed", async () => {
    const cacheDir = await makeCacheDir();
    const counter = join(cacheDir, "counter");

    const view = await withFixtureEnv(
      { FEED_COUNTER_FILE: counter, FEED_MODE: "invalid", FEED_HOLD_LOCK: undefined },
      () => getFeed(feedPlugin(), { cacheDir, now: 1_000, timeoutMs: 500 }),
    );

    expect(view.feed).toBeNull();
    expect(view.stale).toBe(true);
    expect(view.error).toContain("invalid JSON");
  });

  test("returns a timeout error when the command exceeds its deadline", async () => {
    const cacheDir = await makeCacheDir();
    const counter = join(cacheDir, "counter");

    const view = await withFixtureEnv(
      { FEED_COUNTER_FILE: counter, FEED_MODE: "sleep", FEED_HOLD_LOCK: undefined },
      () => getFeed(feedPlugin(), { cacheDir, now: 1_000, timeoutMs: 50 }),
    );

    expect(view.feed).toBeNull();
    expect(view.stale).toBe(true);
    expect(view.error).toContain("timeout");
  });

  test("removes an abandoned lock before fetching", async () => {
    const cacheDir = await makeCacheDir();
    const counter = join(cacheDir, "counter");
    const lock = join(cacheDir, "test-feed.lock");
    const now = Date.now();

    await mkdir(lock, { recursive: true });
    await utimes(lock, (now - 101) / 1_000, (now - 101) / 1_000);

    const view = await withFixtureEnv(
      { FEED_COUNTER_FILE: counter, FEED_MODE: "good", FEED_HOLD_LOCK: undefined },
      () => getFeed(feedPlugin(), { cacheDir, now, timeoutMs: 50 }),
    );

    expect(view.error).toBeNull();
    expect(view.stale).toBe(false);
    expect(await counterLines(counter)).toBe(1);
  });
});
