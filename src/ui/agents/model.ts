import { basename } from "node:path";

import { buildInbox, type SeenMap } from "../../agents/inbox";
import type { Answered } from "../../agents/send-approval";
import type { AgentEntry, AgentRecord } from "../../agents/state";
import type { PaneInfo } from "../../tmux/tmux";

export type Display = "idle" | "working" | "ask" | "running" | "done";

export type Row =
  | { kind: "agent"; record: AgentRecord; display: Display }
  | { kind: "error"; file: string; error: string };

export type AgentsModel = {
  inbox: Row[];
  groups: Array<{ label: string; rows: Row[] }>;
  errors: Row[];
};

// Fallback for a record whose pane is not in the live list; live panes use tmux's automatic-rename flag.
const GENERIC_WINDOW_NAMES = new Set(["claude", "node", "bun", "zsh", "bash", "fish", "sh", "login"]);

function displayOf(record: AgentRecord, answered: Map<string, Answered>): Display {
  if (record.state !== "ask") return record.state;
  // No event fires between an approval and the tool finishing, so a sent yes means running.
  const marker = answered.get(record.paneId);
  return marker?.action === "yes" && marker.requestId === record.question?.requestId ? "running" : "ask";
}

type Group = { key: string; session: string; windowIndex: number; label: string; rows: Row[] };

export function buildAgentsModel(
  entries: AgentEntry[],
  seen: SeenMap,
  answered: Map<string, Answered>,
  panes: PaneInfo[],
): AgentsModel {
  const paneById = new Map(panes.map((p) => [p.paneId, p]));
  const agentRows: Array<Row & { kind: "agent" }> = [];
  const errors: Row[] = [];
  for (const entry of entries) {
    if (entry.ok) {
      agentRows.push({ kind: "agent", record: entry.record, display: displayOf(entry.record, answered) });
    } else {
      errors.push({ kind: "error", file: entry.file, error: entry.error });
    }
  }

  const groups = new Map<string, Group>();
  for (const row of agentRows) {
    const pane = paneById.get(row.record.paneId);
    // A record whose pane is missing from the list still gets a group, keyed by what it reported.
    const key = pane ? pane.windowId : `${row.record.session}/${row.record.window}`;
    let group = groups.get(key);
    if (!group) {
      const windowName = pane?.window ?? row.record.window;
      group = {
        key,
        session: pane?.session ?? row.record.session,
        windowIndex: pane?.windowIndex ?? Number.MAX_SAFE_INTEGER,
        label: (pane ? pane.autoNamed : GENERIC_WINDOW_NAMES.has(windowName)) ? basename(row.record.cwd) : windowName,
        rows: [],
      };
      groups.set(key, group);
    }
    group.rows.push(row);
  }

  const ordered = [...groups.values()].sort(
    (a, b) =>
      a.session.localeCompare(b.session, undefined, { numeric: true }) ||
      a.windowIndex - b.windowIndex ||
      a.key.localeCompare(b.key, undefined, { numeric: true }),
  );

  const rowByPane = new Map(agentRows.map((row) => [row.record.paneId, row]));
  const inboxCandidates = agentRows.filter((row) => row.display !== "running").map((row) => row.record);
  const inbox = buildInbox(inboxCandidates, seen).map((record) => rowByPane.get(record.paneId)!);

  return { inbox, groups: ordered.map(({ label, rows }) => ({ label, rows })), errors };
}
