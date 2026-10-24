import { z } from "zod";

export type Color = "work" | "ask" | "done" | "error" | "dim" | "info";

export type FeedItem = {
  id: string;
  text: string;
  icon?: string;
  color?: Color;
  meta?: string;
  action?: string;
};

export type FeedSection = {
  title: string;
  items: FeedItem[];
};

export type Feed = {
  sections: FeedSection[];
};

export type FeedResult =
  | { ok: true; feed: Feed }
  | { ok: false; error: string };

const feedSchema = z.object({
  sections: z.array(
    z.object({
      title: z.string(),
      items: z.array(
        z.object({
          id: z.string(),
          text: z.string(),
          icon: z.string().optional(),
          color: z.enum(["work", "ask", "done", "error", "dim", "info"]).optional(),
          meta: z.string().optional(),
          action: z.string().optional(),
        }),
      ),
    }),
  ),
});

function formatIssues(issues: z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.join(".") || "feed";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function parseFeed(stdout: string): FeedResult {
  let value: unknown;

  try {
    value = JSON.parse(stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `invalid JSON: ${message}` };
  }

  const parsed = feedSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: formatIssues(parsed.error.issues) };
  }

  return { ok: true, feed: parsed.data };
}
