import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentRecord } from "./state";

export type SeenMap = Map<string, number>;

export async function readSeen(dir: string): Promise<SeenMap> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }

  const seen: SeenMap = new Map();
  for (const name of names) {
    const text = (await readFile(join(dir, name), "utf8")).trim();
    // A bad mark only means the pane counts as not seen, so its done shows again.
    if (!/^\d+$/.test(text)) continue;
    seen.set(name, Number(text));
  }
  return seen;
}

export async function markSeen(dir: string, paneId: string, now: number): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, paneId), String(now));
}

export function buildInbox(records: AgentRecord[], seen: SeenMap): AgentRecord[] {
  const asks = records.filter((r) => r.state === "ask");
  const done = records.filter((r) => r.state === "done" && r.updatedAt > (seen.get(r.paneId) ?? 0));
  const oldestFirst = (a: AgentRecord, b: AgentRecord) => a.updatedAt - b.updatedAt;
  return [...asks.sort(oldestFirst), ...done.sort(oldestFirst)];
}
