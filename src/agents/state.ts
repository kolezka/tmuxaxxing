import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export type AgentState = "idle" | "working" | "ask" | "done";

// requestId is Claude Code's tool_use_id for the pending call.
export type AgentQuestion = { requestId: string; tool: string; summary: string };

export type AgentRecord = {
  paneId: string;
  session: string;
  window: string;
  cwd: string;
  pid: number;
  state: AgentState;
  title?: string;
  question?: AgentQuestion;
  updatedAt: number;
};

export type AgentEntry =
  | { ok: true; file: string; record: AgentRecord }
  | { ok: false; file: string; error: string };

export type Liveness = { panes: Set<string>; isPidAlive: (pid: number) => boolean };

const questionSchema = z.object({
  requestId: z.string().min(1),
  tool: z.string(),
  summary: z.string(),
});

const recordSchema = z
  .object({
    paneId: z.string().min(1),
    session: z.string(),
    window: z.string(),
    cwd: z.string(),
    pid: z.number().int().positive(),
    state: z.enum(["idle", "working", "ask", "done"]),
    title: z.string().optional(),
    question: questionSchema.optional(),
    updatedAt: z.number(),
  })
  .superRefine((record, ctx) => {
    if (record.state === "ask" && !record.question) {
      ctx.addIssue({ code: "custom", path: ["question"], message: "required when state is ask" });
    }
    if (record.state !== "ask" && record.question) {
      ctx.addIssue({ code: "custom", path: ["question"], message: "only allowed when state is ask" });
    }
  });

export function parseAgentRecord(text: string): AgentRecord {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid JSON: ${message}`);
  }
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "record"}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid record: ${detail}`);
  }
  return parsed.data;
}

function compareEntries(a: AgentEntry, b: AgentEntry): number {
  // Error entries go last, ordered by file, since they have no session to sort by.
  if (!a.ok || !b.ok) {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return a.file.localeCompare(b.file);
  }
  const opts = { numeric: true } as const;
  return (
    a.record.session.localeCompare(b.record.session, undefined, opts) ||
    a.record.window.localeCompare(b.record.window, undefined, opts) ||
    a.record.paneId.localeCompare(b.record.paneId, undefined, opts)
  );
}

export async function readAgentDir(dir: string, live: Liveness): Promise<AgentEntry[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const entries: AgentEntry[] = [];
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const file = join(dir, name);
    let record: AgentRecord;
    try {
      record = parseAgentRecord(await readFile(file, "utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      entries.push({ ok: false, file, error: `${name}: ${message}` });
      continue;
    }
    if (!live.panes.has(record.paneId) || !live.isPidAlive(record.pid)) continue;
    entries.push({ ok: true, file, record });
  }
  return entries.sort(compareEntries);
}
