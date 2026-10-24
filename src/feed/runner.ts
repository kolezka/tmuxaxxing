import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { PluginDef } from "../config/plugins";
import { parseFeed, type Feed } from "./schema";

export type FeedView = {
  feed: Feed | null;
  error: string | null;
  stale: boolean;
  fetchedAt: number | null;
};

type CachedFeed = {
  fetchedAt: number | null;
  feed: Feed | null;
  error: string | null;
};

function cachePath(cacheDir: string, name: string): string {
  return join(cacheDir, `${name}.json`);
}

function lockPath(cacheDir: string, name: string): string {
  return join(cacheDir, `${name}.lock`);
}

function toView(cached: CachedFeed): FeedView {
  return {
    feed: cached.feed,
    error: cached.error,
    stale: cached.error !== null,
    fetchedAt: cached.fetchedAt,
  };
}

function isCachedFeed(value: unknown): value is CachedFeed {
  if (!value || typeof value !== "object") {
    return false;
  }

  const cached = value as Record<string, unknown>;
  return (
    (typeof cached.fetchedAt === "number" || cached.fetchedAt === null) &&
    (typeof cached.feed === "object" || cached.feed === null) &&
    (typeof cached.error === "string" || cached.error === null)
  );
}

async function readCache(path: string): Promise<CachedFeed | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return isCachedFeed(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeCache(path: string, cached: CachedFeed): Promise<void> {
  const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, JSON.stringify(cached), "utf8");
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function removeAbandonedLock(path: string, timeoutMs: number): Promise<void> {
  try {
    const lock = await stat(path);
    if (Date.now() - lock.mtimeMs > timeoutMs * 2) {
      await rm(path, { recursive: true, force: true });
    }
  } catch {
    return;
  }
}

async function acquireLock(path: string, timeoutMs: number): Promise<boolean> {
  await removeAbandonedLock(path, timeoutMs);

  try {
    await mkdir(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }

    throw error;
  }
}

async function lockExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function waitForCache(
  cache: string,
  lock: string,
  timeoutMs: number,
): Promise<CachedFeed | null> {
  const deadline = Date.now() + timeoutMs;

  while (await lockExists(lock)) {
    await removeAbandonedLock(lock, timeoutMs);
    if (!(await lockExists(lock))) {
      break;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return await readCache(cache);
    }

    await Bun.sleep(Math.min(100, remaining));
  }

  return await readCache(cache);
}

function failureView(cached: CachedFeed | null, error: string): FeedView {
  return {
    feed: cached?.feed ?? null,
    error,
    stale: true,
    fetchedAt: cached?.fetchedAt ?? null,
  };
}

function firstStderrLine(stderr: string): string | null {
  return stderr.split(/\r?\n/).find((line) => line.length > 0) ?? null;
}

async function runCommand(
  def: PluginDef,
  timeoutMs: number,
): Promise<{ stdout: string; error: string | null }> {
  const child = Bun.spawn({
    cmd: ["/bin/sh", "-c", def.command],
    cwd: def.dir,
    detached: true,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, timeoutMs);

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  clearTimeout(timer);

  if (timedOut) {
    return { stdout, error: `feed command timeout after ${timeoutMs}ms` };
  }

  if (exitCode !== 0) {
    const detail = firstStderrLine(stderr);
    return {
      stdout,
      error: detail ? `feed command exited with ${exitCode}: ${detail}` : `feed command exited with ${exitCode}`,
    };
  }

  return { stdout, error: null };
}

export async function getFeed(
  def: PluginDef,
  opts: { cacheDir: string; now: number; timeoutMs: number; force?: boolean },
): Promise<FeedView> {
  const cache = cachePath(opts.cacheDir, def.name);
  const lock = lockPath(opts.cacheDir, def.name);

  try {
    await mkdir(opts.cacheDir, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failureView(null, `could not create feed cache directory: ${message}`);
  }

  const current = await readCache(cache);
  if (
    !opts.force &&
    current &&
    current.fetchedAt !== null &&
    def.refreshMs !== null &&
    opts.now - current.fetchedAt < def.refreshMs
  ) {
    return toView(current);
  }

  let hasLock: boolean;
  try {
    hasLock = await acquireLock(lock, opts.timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failureView(current, `could not acquire feed lock: ${message}`);
  }

  if (!hasLock) {
    const waited = await waitForCache(cache, lock, opts.timeoutMs);
    return waited
      ? toView(waited)
      : failureView(null, "timed out waiting for feed cache");
  }

  try {
    const previous = await readCache(cache);
    const command = await runCommand(def, opts.timeoutMs);

    if (command.error) {
      const view = failureView(previous, command.error);
      await writeCache(cache, {
        fetchedAt: view.fetchedAt,
        feed: view.feed,
        error: view.error,
      });
      return view;
    }

    const parsed = parseFeed(command.stdout);
    if (!parsed.ok) {
      const view = failureView(previous, parsed.error);
      await writeCache(cache, {
        fetchedAt: view.fetchedAt,
        feed: view.feed,
        error: view.error,
      });
      return view;
    }

    const cached = { fetchedAt: opts.now, feed: parsed.feed, error: null };
    await writeCache(cache, cached);
    return toView(cached);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const previous = await readCache(cache);
    const view = failureView(previous, `feed command failed: ${message}`);

    try {
      await writeCache(cache, {
        fetchedAt: view.fetchedAt,
        feed: view.feed,
        error: view.error,
      });
    } catch {
      return view;
    }

    return view;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
