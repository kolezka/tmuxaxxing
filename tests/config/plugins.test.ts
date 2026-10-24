import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  discoverPlugins,
  parseDuration,
  resolveSlot,
} from "../../src/config/plugins";

async function writePlugin(
  directory: string,
  name: string,
  contents: string,
): Promise<void> {
  const pluginDir = join(directory, name);
  await mkdir(pluginDir, { recursive: true });
  await writeFile(join(pluginDir, "plugin.toml"), contents);
}

const feedPluginToml = `
kind = "feed"
command = "bun ./feed.ts"
refresh = "2m"
`;

describe("plugin configuration", () => {
  test("parses supported refresh durations", () => {
    expect(parseDuration("2m")).toBe(120_000);
    expect(parseDuration("30s")).toBe(30_000);
  });

  test("rejects an unsupported refresh duration", () => {
    expect(() => parseDuration("soon")).toThrow();
  });

  test("uses a user plugin in preference to a built-in plugin", async () => {
    const root = await mkdtemp(join(tmpdir(), "tmuxaxxing-plugins-"));
    const builtinDir = join(root, "builtins");
    const userDir = join(root, "user");

    try {
      await writePlugin(builtinDir, "github-prs", feedPluginToml);
      await writePlugin(userDir, "github-prs", feedPluginToml);

      const { plugins, errors } = await discoverPlugins([builtinDir, userDir]);

      expect(errors).toEqual([]);
      expect(plugins.get("github-prs")?.dir).toBe(join(userDir, "github-prs"));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("reports an invalid plugin kind without loading the plugin", async () => {
    const root = await mkdtemp(join(tmpdir(), "tmuxaxxing-plugins-"));

    try {
      await writePlugin(
        root,
        "bad-widget",
        'kind = "widget"\ncommand = "bun ./widget.ts"\n',
      );

      const { plugins, errors } = await discoverPlugins([root]);

      expect(plugins.has("bad-widget")).toBe(false);
      expect(errors.join("\n")).toContain("bad-widget");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("reports an invalid refresh duration without loading the plugin", async () => {
    const root = await mkdtemp(join(tmpdir(), "tmuxaxxing-plugins-"));

    try {
      await writePlugin(
        root,
        "bad-refresh",
        'kind = "feed"\ncommand = "bun ./feed.ts"\nrefresh = ""\n',
      );

      const { plugins, errors } = await discoverPlugins([root]);

      expect(plugins.has("bad-refresh")).toBe(false);
      expect(errors.join("\n")).toContain("bad-refresh");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("returns an error entry for an unknown slot plugin", () => {
    const result = resolveSlot(
      { plugins: ["github-pr"], width: 36 },
      new Map(),
    );

    expect(result).toEqual({
      width: 36,
      entries: [
        { ok: false, name: "github-pr", error: "unknown plugin" },
      ],
    });
  });
});
