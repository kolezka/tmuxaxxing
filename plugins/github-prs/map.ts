import type { Color, Feed, FeedItem } from "../../src/feed/schema";

export type GhPr = {
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string;
  updatedAt: string;
  isDraft: boolean;
  ci: "pass" | "fail" | "pending" | null;
  review: "approved" | "changes_requested" | "review_required" | null;
};

function relativeAge(updatedAt: string, now: number): string {
  const elapsedMinutes = Math.max(0, Math.floor((now - Date.parse(updatedAt)) / 60_000));

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h`;
  }

  return `${Math.floor(elapsedHours / 24)}d`;
}

function myPrPresentation(pr: GhPr): Pick<FeedItem, "icon" | "color"> {
  if (pr.isDraft) {
    return { icon: "◌", color: "dim" };
  }

  const ciPresentation: Record<Exclude<GhPr["ci"], null>, { icon: string; color: Color }> = {
    fail: { icon: "✘", color: "error" },
    pending: { icon: "●", color: "work" },
    pass: { icon: "✔", color: "done" },
  };

  return pr.ci === null ? {} : ciPresentation[pr.ci];
}

function myPrState(pr: GhPr): string {
  if (pr.isDraft) {
    return "draft";
  }

  return pr.ci ?? pr.review ?? "open";
}

function mapPr(pr: GhPr, now: number, mine: boolean): FeedItem {
  return {
    id: `pr-${pr.repo}-${pr.number}`,
    text: `#${pr.number} ${pr.title}`,
    meta: `${mine ? myPrState(pr) : pr.author} · ${relativeAge(pr.updatedAt, now)}`,
    action: `open '${pr.url}'`,
    ...(mine ? myPrPresentation(pr) : {}),
  };
}

export function mapPrsToFeed(
  input: { review: GhPr[]; mine: GhPr[]; assigned: GhPr[] },
  now: number,
): Feed {
  return {
    sections: [
      { title: "REVIEW REQUESTS", items: input.review.map((pr) => mapPr(pr, now, false)) },
      { title: "MY OPEN PRS", items: input.mine.map((pr) => mapPr(pr, now, true)) },
      { title: "ASSIGNED TO ME", items: input.assigned.map((pr) => mapPr(pr, now, false)) },
    ],
  };
}
