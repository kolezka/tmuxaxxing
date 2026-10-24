import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_LAYOUT,
  LayoutError,
  loadLayout,
  parseLayout,
} from "../../src/config/layout";

const layoutToml = `
[left]
plugins = ["agents"]
width = 32

[right]
plugins = ["github-prs"]
width = 36
`;

describe("layout configuration", () => {
  test("parses the documented layout", () => {
    expect(parseLayout(layoutToml)).toEqual({
      left: { plugins: ["agents"], width: 32 },
      right: { plugins: ["github-prs"], width: 36 },
    });
  });

  test("fills an omitted right slot from the default layout", () => {
    expect(parseLayout(`
[left]
plugins = ["agents"]
width = 32
`)).toEqual({
      left: { plugins: ["agents"], width: 32 },
      right: DEFAULT_LAYOUT.right,
    });
  });

  test("wraps malformed TOML in LayoutError", () => {
    expect(() => parseLayout("[left\n")).toThrow(LayoutError);
  });

  test("rejects zero width", () => {
    expect(() => parseLayout(`
[left]
width = 0
`)).toThrow(LayoutError);
  });

  test("rejects a nonnumeric width", () => {
    expect(() => parseLayout(`
[left]
width = "wide"
`)).toThrow(LayoutError);
  });

  test("uses the default layout when the file is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tmuxaxxing-layout-"));

    try {
      await expect(loadLayout(join(directory, "layout.toml"))).resolves.toEqual(
        DEFAULT_LAYOUT,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("rejects a malformed layout file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tmuxaxxing-layout-"));
    const path = join(directory, "layout.toml");

    try {
      await writeFile(path, "[left\n");
      await expect(loadLayout(path)).rejects.toBeInstanceOf(LayoutError);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
