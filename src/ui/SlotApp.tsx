import { Box, Text, useInput } from "ink";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import type { PluginDef, ResolvedSlot } from "../config/plugins";
import type { FeedView } from "../feed/runner";
import type { FeedItem } from "../feed/schema";
import { FeedPanel } from "./FeedPanel";
import { useMouse, type MouseEvent } from "./mouse";

const DEFAULT_REFRESH_MS = 120_000;

type SlotAppProps = {
  slot: ResolvedSlot;
  width: number;
  height: number;
  loadFeed(def: PluginDef, force: boolean): Promise<FeedView>;
  runAction(cmd: string, cwd: string): void;
};

function failedFeed(error: unknown): FeedView {
  return {
    feed: null,
    error: error instanceof Error ? error.message : String(error),
    stale: true,
    fetchedAt: null,
  };
}

// Tab labels on one line, with the 1-based column span each label occupies.
export function tabLine(names: string[], active: number): { text: string; spans: { start: number; end: number }[] } {
  const spans: { start: number; end: number }[] = [];
  let text = "";
  names.forEach((name, index) => {
    if (index > 0) text += " ";
    const label = index === active ? `[${name}]` : name;
    spans.push({ start: text.length + 1, end: text.length + label.length });
    text += label;
  });
  return { text, spans };
}

export function SlotApp({ slot, width, height, loadFeed, runAction }: SlotAppProps): React.ReactNode {
  const feedEntries = useMemo(
    () =>
      slot.entries.filter(
        (entry): entry is { ok: true; plugin: PluginDef } => entry.ok && entry.plugin.kind === "feed",
      ),
    [slot.entries],
  );
  const [selectedTab, setSelectedTab] = useState(0);
  const [views, setViews] = useState<Record<string, FeedView>>({});
  const activeIndex = Math.min(selectedTab, Math.max(0, feedEntries.length - 1));
  const activePlugin = feedEntries[activeIndex]?.plugin;

  const refresh = useCallback(
    async (plugin: PluginDef, force: boolean): Promise<void> => {
      const view = await loadFeed(plugin, force).catch(failedFeed);
      setViews((current) => ({ ...current, [plugin.name]: view }));
    },
    [loadFeed],
  );

  useEffect(() => {
    setSelectedTab((current) => Math.min(current, Math.max(0, feedEntries.length - 1)));
    const timers = feedEntries.map(({ plugin }) => {
      void refresh(plugin, false);
      return setInterval(() => {
        void refresh(plugin, false);
      }, plugin.refreshMs ?? DEFAULT_REFRESH_MS);
    });

    return () => {
      timers.forEach(clearInterval);
    };
  }, [feedEntries, refresh]);

  useInput((_input, key) => {
    if (key.tab && feedEntries.length > 1) {
      setSelectedTab((current) => (current + 1) % feedEntries.length);
    }
  });

  const errorEntries = slot.entries.filter(
    (entry): entry is { ok: false; name: string; error: string } => !entry.ok,
  );
  const tabs = useMemo(
    () => (feedEntries.length > 1 ? tabLine(feedEntries.map(({ plugin }) => plugin.name), activeIndex) : null),
    [feedEntries, activeIndex],
  );
  const tabRow = errorEntries.length + 1;
  const top = errorEntries.length + (tabs ? 1 : 0);
  const view = activePlugin ? views[activePlugin.name] : undefined;

  const onMouse = useCallback(
    (event: MouseEvent) => {
      if (!tabs || event.button !== "left" || !event.pressed || event.y !== tabRow) return;
      const hit = tabs.spans.findIndex((span) => event.x >= span.start && event.x <= span.end);
      if (hit >= 0) setSelectedTab(hit);
    },
    [tabs, tabRow],
  );
  useMouse(onMouse);

  const onAction = useCallback(
    (item: FeedItem): void => {
      if (item.action && activePlugin) {
        runAction(item.action, activePlugin.dir);
      }
    },
    [activePlugin, runAction],
  );

  return (
    <Box flexDirection="column">
      {errorEntries.map((entry) => (
        <Text color="red" key={entry.name}>{`${entry.name}: ${entry.error}`}</Text>
      ))}
      {tabs ? <Text>{tabs.text}</Text> : null}
      {activePlugin && view ? (
        <FeedPanel
          view={view}
          width={width}
          height={Math.max(0, height - top)}
          top={top}
          onAction={onAction}
          onRefresh={() => {
            void refresh(activePlugin, true);
          }}
        />
      ) : null}
    </Box>
  );
}
