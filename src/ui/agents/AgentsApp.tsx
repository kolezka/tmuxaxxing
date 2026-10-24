import { join } from "node:path";

import { Box, Text, useInput } from "ink";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ApprovalAction } from "../../agents/approve";
import { markSeen, readSeen } from "../../agents/inbox";
import { readAnswered, sendApproval, type SendResult } from "../../agents/send-approval";
import { readAgentDir } from "../../agents/state";
import type { Color } from "../../feed/schema";
import { livenessFrom, type Tmux } from "../../tmux/tmux";
import { inkColor } from "../colors";
import { visibleRange } from "../window";
import { buildAgentsModel, type AgentsModel, type Display, type Row } from "./model";

export type AgentsDeps = { tmux: Tmux; stateDir: string; now(): number; pollMs: number };

type AgentsAppProps = { deps: AgentsDeps; width: number; height: number };

type Item = { key: string; row: Row; section: "inbox" | "group" | "error" };

type Line = { text: string; color?: string; bold?: boolean; dim?: boolean; item?: number };

type Flash = { text: string; color: string };

const FLASH_MS = 3000;
const SUMMARY_MAX_LINES = 3;

const glyphs: Record<Display, string> = { idle: "○", working: "●", running: "●", ask: "?", done: "✓" };
const colorOf: Record<Display, Color> = { idle: "dim", working: "work", running: "work", ask: "ask", done: "done" };

const changed = "changed, open the session instead";
const refusals: Record<Exclude<SendResult, { send: true }>["reason"], string> = {
  changed,
  "dialog-not-visible": changed,
  "no-option-not-found": changed,
  "already-answered": changed,
  gone: "gone",
  unreadable: "unreadable",
  "not-asking": "not an approval",
};

function truncate(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  return width === 1 ? "…" : `${value.slice(0, width - 1)}…`;
}

function wrap(value: string, width: number, maxLines: number): string[] {
  if (width <= 0) return [];
  const lines: string[] = [];
  for (let start = 0; start < value.length && lines.length < maxLines; start += width) {
    lines.push(value.slice(start, start + width));
  }
  if (lines.length === maxLines && value.length > width * maxLines) {
    lines[maxLines - 1] = truncate(`${lines[maxLines - 1]}…`, width);
  }
  return lines;
}

// Breaks at spaces so a message reads cleanly; a word longer than the width is cut.
function wrapWords(value: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of value.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  const shown = lines.slice(0, maxLines).map((line) => truncate(line, width));
  if (lines.length > maxLines) shown[maxLines - 1] = truncate(`${shown[maxLines - 1]}…`, width);
  return shown;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildItems(model: AgentsModel): Item[] {
  const keyOf = (row: Row) => (row.kind === "agent" ? row.record.paneId : row.file);
  return [
    ...model.inbox.map((row) => ({ key: `inbox:${keyOf(row)}`, row, section: "inbox" as const })),
    ...model.groups.flatMap((group) => group.rows.map((row) => ({ key: `group:${keyOf(row)}`, row, section: "group" as const }))),
    ...model.errors.map((row) => ({ key: `error:${keyOf(row)}`, row, section: "error" as const })),
  ];
}

function buildLines(model: AgentsModel, items: Item[], selected: number, width: number): Line[] {
  const labelByPane = new Map<string, string>();
  for (const group of model.groups) {
    for (const row of group.rows) {
      if (row.kind === "agent") labelByPane.set(row.record.paneId, group.label);
    }
  }

  const lines: Line[] = [];
  const prefix = (index: number) => (index === selected ? "> " : "  ");
  const agentLine = (index: number, row: Row & { kind: "agent" }, name: string): Line => ({
    text: truncate(`${prefix(index)}${glyphs[row.display]} ${name} ${row.display}`, width),
    color: inkColor(colorOf[row.display]),
    item: index,
  });

  model.inbox.forEach((row, index) => {
    if (row.kind !== "agent") return;
    lines.push(agentLine(index, row, labelByPane.get(row.record.paneId) ?? row.record.paneId));
    const question = row.record.question;
    if (row.display === "ask" && question) {
      for (const text of wrap(`${question.tool}: ${question.summary}`, width - 4, SUMMARY_MAX_LINES)) {
        lines.push({ text: `    ${text}`, dim: true, item: index });
      }
    }
  });
  if (model.inbox.length === 0) lines.push({ text: truncate("  (empty)", width), dim: true });

  let index = model.inbox.length;
  for (const group of model.groups) {
    lines.push({ text: truncate(group.label, width), bold: true });
    for (const row of group.rows) {
      if (row.kind === "agent") {
        lines.push(agentLine(index, row, row.record.title ?? group.label));
      }
      index += 1;
    }
  }

  if (model.errors.length > 0) {
    lines.push({ text: truncate("ERRORS", width), bold: true, color: inkColor("error") });
    for (const row of model.errors) {
      if (row.kind === "error") {
        lines.push({ text: truncate(`${prefix(index)}${row.error}`, width), color: inkColor("error"), item: index });
      }
      index += 1;
    }
  }
  return lines;
}

export function AgentsApp({ deps, width, height }: AgentsAppProps): React.ReactNode {
  const { tmux, stateDir, now, pollMs } = deps;
  const [model, setModel] = useState<AgentsModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [lastIndex, setLastIndex] = useState(0);
  const [flash, setFlash] = useState<Flash | null>(null);
  const mounted = useRef(true);
  const loading = useRef(false);
  const busy = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    if (loading.current) return;
    loading.current = true;
    try {
      const panes = await tmux.listPanes();
      const entries = await readAgentDir(join(stateDir, "agents"), livenessFrom(panes));
      const [seen, answered] = await Promise.all([readSeen(join(stateDir, "seen")), readAnswered(stateDir)]);
      if (!mounted.current) return;
      setModel(buildAgentsModel(entries, seen, answered, panes));
      setLoadError(null);
    } catch (error) {
      // Never keep showing an old state as if it were current.
      if (!mounted.current) return;
      setModel(null);
      setLoadError(messageOf(error));
    } finally {
      loading.current = false;
    }
  }, [tmux, stateDir]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = setInterval(() => void load(), pollMs);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [load, pollMs]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  const items = useMemo(() => (model ? buildItems(model) : []), [model]);
  // Selection follows the row's identity, so a poll that reorders rows cannot move it under the owner.
  const keyIndex = selectedKey === null ? -1 : items.findIndex((item) => item.key === selectedKey);
  const selected = items.length === 0 ? 0 : keyIndex >= 0 ? keyIndex : Math.min(lastIndex, items.length - 1);

  function select(index: number): void {
    setLastIndex(index);
    setSelectedKey(items[index]?.key ?? null);
  }

  function show(text: string, color = "yellow"): void {
    setFlash({ text, color });
  }

  async function approve(action: ApprovalAction, index: number): Promise<void> {
    const row = items[index]?.row;
    if (!row || row.kind !== "agent" || row.display !== "ask" || !row.record.question) {
      show("not an approval");
      return;
    }
    if (busy.current) return;
    busy.current = true;
    try {
      const result = await sendApproval(
        { paneId: row.record.paneId, expectedRequestId: row.record.question.requestId, action },
        { tmux, stateDir, now: now() },
      );
      if (!mounted.current) return;
      if (result.send) show(`sent ${action}`, "green");
      else show(refusals[result.reason]);
    } catch (error) {
      if (mounted.current) show(messageOf(error), "red");
    } finally {
      busy.current = false;
    }
    await load();
  }

  async function jump(index: number): Promise<void> {
    const row = items[index]?.row;
    if (!row || row.kind !== "agent") return;
    try {
      await tmux.jumpTo(row.record.paneId);
      await markSeen(join(stateDir, "seen"), row.record.paneId, now());
    } catch (error) {
      if (mounted.current) show(messageOf(error), "red");
    }
    await load();
  }

  useInput((input, key) => {
    if (key.return) {
      void jump(selected);
      return;
    }
    let index = selected;
    for (const character of input) {
      if (character === "j") index = Math.min(index + 1, Math.max(0, items.length - 1));
      else if (character === "k") index = Math.max(0, index - 1);
      else if (character === "n" && model && model.inbox.length > 0) index = 0;
      else if (character === "y") void approve("yes", index);
      else if (character === "x") void approve("no", index);
    }
    if (index !== selected) select(index);
  });

  const header = model ? `INBOX ${model.inbox.length}` : "INBOX";
  const footer: Flash | null = loadError ? { text: loadError, color: "red" } : flash;
  const lines = model ? buildLines(model, items, selected, width) : [];
  const selectedLine = Math.max(0, lines.findIndex((line) => line.item === selected));
  // At 32 columns the refusal message is one character too long for a single line.
  const footerLines = footer ? wrapWords(footer.text, width, 2) : [];
  const bodyHeight = Math.max(0, height - 1 - footerLines.length);
  const range = visibleRange(lines.length, selectedLine, bodyHeight);

  return (
    <Box flexDirection="column">
      <Text bold>{truncate(header, width)}</Text>
      {lines.slice(range.start, range.end).map((line, index) => (
        <Text key={range.start + index} color={line.color} bold={line.bold} dimColor={line.dim} wrap="truncate">
          {line.text}
        </Text>
      ))}
      {footerLines.map((text, index) => (
        <Text key={`footer-${index}`} color={footer?.color} wrap="truncate">
          {text}
        </Text>
      ))}
    </Box>
  );
}
