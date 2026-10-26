import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { DISABLE_MOUSE, ENABLE_MOUSE, splitMouse } from "../ui/mouse";

type TtyLike = NodeJS.ReadStream & { setRawMode?: (enabled: boolean) => unknown };

// Ink drops complete mouse reports before they reach useInput, so this stream
// sits between the terminal and Ink: mouse reports go out as `mouse` events on
// `mouse`, everything else flows through to Ink as it was.
export class MouseStdin extends PassThrough {
  readonly mouse = new EventEmitter();
  readonly isTTY: boolean;
  private pending = "";

  constructor(private readonly source: TtyLike) {
    super();
    this.isTTY = Boolean(source.isTTY);
    source.setEncoding("utf8");
    source.on("data", (chunk: string | Buffer) => {
      const split = splitMouse(String(chunk), this.pending);
      this.pending = split.pending;
      for (const event of split.events) this.mouse.emit("mouse", event);
      if (split.text) this.write(split.text);
    });
    source.on("end", () => this.end());
  }

  setRawMode(enabled: boolean): this {
    this.source.setRawMode?.(enabled);
    return this;
  }

  ref(): this {
    this.source.ref?.();
    return this;
  }

  unref(): this {
    this.source.unref?.();
    return this;
  }
}

export type MouseSetup = { stdin: MouseStdin; release(): void };

// Turns mouse reporting on for the life of the app. Only on a real terminal:
// a piped run keeps plain stdin and never writes escapes into its output.
export function withMouse(stdin: TtyLike = process.stdin, stdout: NodeJS.WriteStream = process.stdout): MouseSetup | null {
  if (!stdin.isTTY || !stdout.isTTY) return null;
  const wrapped = new MouseStdin(stdin);
  stdout.write(ENABLE_MOUSE);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    stdout.write(DISABLE_MOUSE);
  };
  process.once("exit", release);
  return { stdin: wrapped, release };
}
