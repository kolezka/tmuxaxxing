import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";

import { MouseStdin } from "../../src/cli/mouse-stdin";
import { parseMouse, splitMouse, type MouseEvent } from "../../src/ui/mouse";

describe("parseMouse", () => {
  test("decodes a left press with 1-based pane coordinates", () => {
    expect(parseMouse("\u001b[<0;12;5M")).toEqual({
      button: "left",
      x: 12,
      y: 5,
      pressed: true,
      shift: false,
      meta: false,
      ctrl: false,
    });
  });

  test("decodes a release, the wheel and modifiers", () => {
    expect(parseMouse("\u001b[<0;1;1m")?.pressed).toBe(false);
    expect(parseMouse("\u001b[<64;3;4M")?.button).toBe("wheel-up");
    expect(parseMouse("\u001b[<65;3;4M")?.button).toBe("wheel-down");
    expect(parseMouse("\u001b[<2;3;4M")?.button).toBe("right");
    expect(parseMouse("\u001b[<4;3;4M")?.shift).toBe(true);
    expect(parseMouse("\u001b[<16;3;4M")?.ctrl).toBe(true);
    expect(parseMouse("\u001b[<32;3;4M")?.button).toBe("other");
  });

  test("rejects anything that is not a complete SGR report", () => {
    expect(parseMouse("j")).toBeNull();
    expect(parseMouse("\u001b[<0;12;5")).toBeNull();
    expect(parseMouse("\u001b[A")).toBeNull();
  });
});

describe("splitMouse", () => {
  test("separates reports from keys and keeps the keys in order", () => {
    const split = splitMouse("j\u001b[<0;2;3Mk\u001b[<65;2;3M");
    expect(split.text).toBe("jk");
    expect(split.events.map((event) => event.button)).toEqual(["left", "wheel-down"]);
    expect(split.pending).toBe("");
  });

  test("carries a report cut at a chunk boundary into the next chunk", () => {
    const first = splitMouse("r\u001b[<0;1");
    expect(first.text).toBe("r");
    expect(first.events).toEqual([]);
    expect(first.pending).toBe("\u001b[<0;1");
    const second = splitMouse("2;5M\u001b", first.pending);
    expect(second.events).toEqual([expect.objectContaining({ button: "left", x: 12, y: 5 })]);
    expect(second.text).toBe("");
    expect(second.pending).toBe("\u001b");
  });

  test("passes a lone escape key through once the next chunk shows it is not a report", () => {
    const first = splitMouse("\u001b");
    expect(first.pending).toBe("\u001b");
    const second = splitMouse("[A", first.pending);
    expect(second.text).toBe("\u001b[A");
    expect(second.pending).toBe("");
  });
});

describe("MouseStdin", () => {
  test("emits mouse events and forwards the rest to the reader", async () => {
    const rawModes: boolean[] = [];
    const source = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode(enabled: boolean) {
        rawModes.push(enabled);
      },
    }) as unknown as NodeJS.ReadStream & { setRawMode(enabled: boolean): unknown };
    const wrapped = new MouseStdin(source);
    const events: MouseEvent[] = [];
    const text: string[] = [];
    wrapped.mouse.on("mouse", (event: MouseEvent) => events.push(event));
    wrapped.on("data", (chunk: Buffer | string) => text.push(String(chunk)));
    wrapped.setRawMode(true);

    source.write("j\u001b[<0;4;2M");
    source.write("\u001b[<64;4;2Mk");
    await Bun.sleep(0);

    expect(text.join("")).toBe("jk");
    expect(events.map((event) => [event.button, event.x, event.y])).toEqual([
      ["left", 4, 2],
      ["wheel-up", 4, 2],
    ]);
    expect(rawModes).toEqual([true]);
    expect(wrapped.isTTY).toBe(true);
  });
});
