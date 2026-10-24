import { readFile } from "node:fs/promises";

import { z } from "zod";

export type SlotConfig = {
  plugins: string[];
  width: number;
};

export type Layout = {
  left: SlotConfig;
  right: SlotConfig;
};

export const DEFAULT_LAYOUT: Layout = {
  left: { plugins: ["agents"], width: 32 },
  right: { plugins: ["github-prs"], width: 36 },
};

export class LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutError";
  }
}

const slotSchema = z.object({
  plugins: z.array(z.string()),
  width: z.number().int().positive(),
});

const layoutSchema = z.object({
  left: slotSchema.optional(),
  right: slotSchema.optional(),
});

function formatIssues(issues: z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.join(".") || "layout";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function parseLayout(toml: string): Layout {
  let value: unknown;

  try {
    value = Bun.TOML.parse(toml);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LayoutError(`invalid TOML: ${message}`);
  }

  const parsed = layoutSchema.safeParse(value);
  if (!parsed.success) {
    throw new LayoutError(formatIssues(parsed.error.issues));
  }

  return {
    left: parsed.data.left ?? DEFAULT_LAYOUT.left,
    right: parsed.data.right ?? DEFAULT_LAYOUT.right,
  };
}

export async function loadLayout(path: string): Promise<Layout> {
  let toml: string;

  try {
    toml = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_LAYOUT;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new LayoutError(`could not read layout ${path}: ${message}`);
  }

  return parseLayout(toml);
}
