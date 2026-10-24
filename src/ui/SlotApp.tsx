import { Box, Text, useInput } from "ink";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import type { PluginDef, ResolvedSlot } from "../config/plugins";
import type { FeedView } from "../feed/runner";
import type { FeedItem } from "../feed/schema";
import { FeedPanel } from "./FeedPanel";

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
  const view = activePlugin ? views[activePlugin.name] : undefined;

  function onAction(item: FeedItem): void {
    if (item.action && activePlugin) {
      runAction(item.action, activePlugin.dir);
    }
  }

  return (
    <Box flexDirection="column">
      {errorEntries.map((entry) => (
        <Text color="red" key={entry.name}>{`${entry.name}: ${entry.error}`}</Text>
      ))}
      {feedEntries.length > 1 ? (
        <Text>{feedEntries.map(({ plugin }, index) => (index === activeIndex ? `[${plugin.name}]` : plugin.name)).join(" ")}</Text>
      ) : null}
      {activePlugin && view ? (
        <FeedPanel
          view={view}
          width={width}
          height={height}
          onAction={onAction}
          onRefresh={() => {
            void refresh(activePlugin, true);
          }}
        />
      ) : null}
    </Box>
  );
}
