import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { livenessFrom, type Tmux } from "../tmux/tmux";
import { APPROVAL_CONFIG, checkApproval, type ApprovalAction, type GuardResult } from "./approve";
import { readAgentDir, type AgentEntry } from "./state";

export type Answered = { requestId: string; action: ApprovalAction; at: number };

export type SendResult = GuardResult | { send: false; reason: "already-answered" };

const answeredSchema = z.object({
  requestId: z.string().min(1),
  action: z.enum(["yes", "no"]),
  at: z.number(),
});

// Keyed by pane id, taken from the file name. A corrupt marker throws so no key is sent on a guess.
export async function readAnswered(stateDir: string): Promise<Map<string, Answered>> {
  const dir = join(stateDir, "answered");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }

  const answered = new Map<string, Answered>();
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const text = await readFile(join(dir, name), "utf8");
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`answered/${name}: invalid JSON: ${message}`);
    }
    const parsed = answeredSchema.safeParse(value);
    if (!parsed.success) throw new Error(`answered/${name}: invalid marker`);
    answered.set(name.slice(0, -".json".length), parsed.data);
  }
  return answered;
}

async function writeAnswered(stateDir: string, paneId: string, marker: Answered): Promise<void> {
  const dir = join(stateDir, "answered");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${paneId}.json`);
  const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(marker), "utf8");
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function sendApproval(
  args: { paneId: string; expectedRequestId: string; action: ApprovalAction },
  deps: { tmux: Tmux; stateDir: string; now: number },
): Promise<SendResult> {
  const { paneId, expectedRequestId, action } = args;
  const { tmux, stateDir, now } = deps;

  const previous = (await readAnswered(stateDir)).get(paneId);
  if (previous?.requestId === expectedRequestId) return { send: false, reason: "already-answered" };

  const panes = await tmux.listPanes();
  const live = livenessFrom(panes);
  const agentFile = join(stateDir, "agents", `${paneId}.json`);
  const entries = await readAgentDir(join(stateDir, "agents"), live);
  let current: AgentEntry | undefined = entries.find((e) => e.file === agentFile);
  if (current?.ok && current.record.paneId !== paneId) {
    current = { ok: false, file: agentFile, error: `record is for pane ${current.record.paneId}` };
  }

  // A pane that is gone cannot be captured, and checkApproval refuses it anyway.
  const paneText = live.panes.has(paneId) ? await tmux.capturePane(paneId) : "";
  const result = checkApproval({ expectedRequestId, current, paneText }, action, APPROVAL_CONFIG);
  if (!result.send) return result;

  await tmux.sendKeys(paneId, result.keys);
  await writeAnswered(stateDir, paneId, { requestId: expectedRequestId, action, at: now });
  return result;
}
