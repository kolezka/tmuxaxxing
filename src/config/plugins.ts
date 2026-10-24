import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import type { SlotConfig } from "./layout";

export type PluginDef = {
  name: string;
  kind: "feed" | "tui";
  command: string;
  dir: string;
  refreshMs: number | null;
};

export type ResolvedSlot = {
  width: number;
  entries: Array<
    | { ok: true; plugin: PluginDef }
    | { ok: false; name: string; error: string }
  >;
};

const pluginSchema = z.object({
  kind: z.enum(["feed", "tui"]),
  command: z.string().min(1),
  refresh: z.string().optional(),
});

export function parseDuration(s: string): number {
  const match = /^(\d+)(s|m)$/.exec(s);
  if (!match) {
    throw new Error(`invalid duration: ${s}`);
  }

  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`invalid duration: ${s}`);
  }

  return amount * (match[2] === "m" ? 60_000 : 1_000);
}

function formatIssues(issues: z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.join(".") || "plugin";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export async function discoverPlugins(
  dirs: string[],
): Promise<{ plugins: Map<string, PluginDef>; errors: string[] }> {
  const plugins = new Map<string, PluginDef>();
  const errors: string[] = [];

  for (const directory of dirs) {
    let entries;

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      errors.push(`could not read plugin directory ${directory}: ${message}`);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const name = entry.name;
      const dir = join(directory, name);
      const path = join(dir, "plugin.toml");
      let value: unknown;

      try {
        value = Bun.TOML.parse(await readFile(path, "utf8"));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${name}: could not read or parse plugin.toml: ${message}`);
        continue;
      }

      const parsed = pluginSchema.safeParse(value);
      if (!parsed.success) {
        errors.push(`${name}: ${formatIssues(parsed.error.issues)}`);
        continue;
      }

      try {
        plugins.set(name, {
          name,
          kind: parsed.data.kind,
          command: parsed.data.command,
          dir,
          refreshMs:
            parsed.data.refresh === undefined
              ? null
              : parseDuration(parsed.data.refresh),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${name}: ${message}`);
      }
    }
  }

  return { plugins, errors };
}

export function resolveSlot(
  slot: SlotConfig,
  plugins: Map<string, PluginDef>,
): ResolvedSlot {
  return {
    width: slot.width,
    entries: slot.plugins.map((name) => {
      const plugin = plugins.get(name);
      return plugin
        ? { ok: true, plugin }
        : { ok: false, name, error: "unknown plugin" };
    }),
  };
}
