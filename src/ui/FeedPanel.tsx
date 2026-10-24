import { Box, Text, useInput } from "ink";
import React, { useEffect, useMemo, useState } from "react";

import type { FeedView } from "../feed/runner";
import type { FeedItem } from "../feed/schema";
import { inkColor } from "./colors";
import { visibleRange } from "./window";

type PanelItem = {
  item: FeedItem;
};

export type FeedPanelProps = {
  view: FeedView;
  width: number;
  height: number;
  onAction(item: FeedItem): void;
  onRefresh(): void;
};

function truncate(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }

  if (value.length <= width) {
    return value;
  }

  return width === 1 ? "…" : `${value.slice(0, width - 1)}…`;
}

function itemText(item: FeedItem): string {
  return item.icon ? `${item.icon} ${item.text}` : item.text;
}

function Row({ item, selected, width }: { item: FeedItem; selected: boolean; width: number }): React.ReactNode {
  const prefix = selected ? "> " : "  ";
  const available = Math.max(0, width - prefix.length);
  const primary = itemText(item);
  const meta = item.meta ? ` ${item.meta}` : "";
  const shownPrimary = truncate(primary, available);
  const remaining = Math.max(0, available - shownPrimary.length);
  const shownMeta = shownPrimary.length === primary.length ? truncate(meta, remaining) : "";

  return (
    <Text color={inkColor(item.color)}>
      {prefix}
      {shownPrimary}
      {shownMeta ? <Text dimColor>{shownMeta}</Text> : null}
    </Text>
  );
}

export function FeedPanel({ view, width, height, onAction, onRefresh }: FeedPanelProps): React.ReactNode {
  const items = useMemo<PanelItem[]>(
    () => view.feed?.sections.flatMap((section) => section.items.map((item) => ({ item }))) ?? [],
    [view.feed],
  );
  const [selected, setSelected] = useState(0);
  const selectedIndex = Math.min(selected, Math.max(0, items.length - 1));

  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);

  useInput((input, key) => {
    if (key.return) {
      const current = items[selectedIndex];
      if (current) {
        onAction(current.item);
      }
      return;
    }

    for (const character of input) {
      if (character === "j") {
        setSelected((current) => Math.min(current + 1, Math.max(0, items.length - 1)));
      } else if (character === "k") {
        setSelected((current) => Math.max(0, current - 1));
      } else if (character === "r") {
        onRefresh();
      }
    }
  });

  if (!view.feed) {
    return view.error ? <Text color="red">{`${view.error}${view.stale ? " (stale)" : ""}`}</Text> : null;
  }

  const headerRows =
    (view.error ? 1 : 0) +
    view.feed.sections.reduce(
      (count, section) => count + 1 + (section.items.length === 0 ? 1 : 0),
      0,
    );
  const range = visibleRange(items.length, selectedIndex, height - headerRows);
  const visibleItems = items.slice(range.start, range.end);

  return (
    <Box flexDirection="column">
      {view.error ? <Text color="red">{`${view.error}${view.stale ? " (stale)" : ""}`}</Text> : null}
      {view.feed.sections.map((section) => (
        <React.Fragment key={section.title}>
          <Text bold>{truncate(section.title, width)}</Text>
          {section.items.length === 0 ? <Text dimColor>{truncate("(none)", width)}</Text> : null}
        </React.Fragment>
      ))}
      {visibleItems.map(({ item }, index) => (
        <Row item={item} selected={range.start + index === selectedIndex} width={width} key={item.id} />
      ))}
    </Box>
  );
}
