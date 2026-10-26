import { EventEmitter } from "node:events";

import React, { createContext, useContext, useEffect } from "react";

// SGR mouse reporting (modes 1000 + 1006): ESC [ < button ; column ; row M|m
export type MouseButton = "left" | "middle" | "right" | "wheel-up" | "wheel-down" | "other";

export type MouseEvent = {
  button: MouseButton;
  // 1-based, relative to the pane the terminal (or tmux) hands the event to.
  x: number;
  y: number;
  pressed: boolean;
  shift: boolean;
  meta: boolean;
  ctrl: boolean;
};

export const ENABLE_MOUSE = "\u001b[?1000h\u001b[?1006h";
export const DISABLE_MOUSE = "\u001b[?1006l\u001b[?1000l";

const SGR = /\u001b\[<(\d+);(\d+);(\d+)([Mm])/g;

// The longest tail of `text` that could still grow into a full SGR report.
function unfinishedReport(text: string): string {
  const start = text.lastIndexOf("\u001b");
  if (start < 0) return "";
  const tail = text.slice(start);
  // Walk the report grammar: ESC [ < digits ; digits ; digits. Anything that
  // strays from it (an arrow key, a plain escape followed by text) is not ours.
  const shape = "\u001b[<";
  for (let index = 1; index < tail.length; index += 1) {
    if (index < shape.length) {
      if (tail[index] !== shape[index]) return "";
      continue;
    }
    if (!/[0-9;]/.test(tail[index] ?? "")) return "";
  }
  const fields = tail.slice(shape.length).split(";");
  return fields.length <= 3 ? tail : "";
}

function buttonOf(code: number): MouseButton {
  if (code & 64) return (code & 3) === 0 ? "wheel-up" : (code & 3) === 1 ? "wheel-down" : "other";
  if (code & 32) return "other";
  switch (code & 3) {
    case 0:
      return "left";
    case 1:
      return "middle";
    case 2:
      return "right";
    default:
      return "other";
  }
}

export function parseMouse(sequence: string): MouseEvent | null {
  const match = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(sequence);
  if (!match) return null;
  const code = Number(match[1]);
  return {
    button: buttonOf(code),
    x: Number(match[2]),
    y: Number(match[3]),
    pressed: match[4] === "M",
    shift: (code & 4) !== 0,
    meta: (code & 8) !== 0,
    ctrl: (code & 16) !== 0,
  };
}

export type Split = { events: MouseEvent[]; text: string; pending: string };

// Splits mouse reports out of a raw stdin chunk. `pending` carries a report cut
// at a chunk boundary into the next call; anything else is ordinary key input.
export function splitMouse(chunk: string, pending = ""): Split {
  const input = pending + chunk;
  const events: MouseEvent[] = [];
  let text = "";
  let last = 0;
  for (const match of input.matchAll(SGR)) {
    text += input.slice(last, match.index);
    const event = parseMouse(match[0]);
    if (event) events.push(event);
    last = match.index + match[0].length;
  }
  const rest = input.slice(last);
  const carry = unfinishedReport(rest);
  return { events, text: text + rest.slice(0, rest.length - carry.length), pending: carry };
}

export type MouseSource = Pick<EventEmitter, "on" | "off">;

export const MouseContext = createContext<MouseSource | null>(null);

export function MouseProvider({ source, children }: { source: MouseSource | null; children?: React.ReactNode }): React.ReactNode {
  return React.createElement(MouseContext.Provider, { value: source }, children);
}

// Subscribes to mouse events for the lifetime of the component. Without a
// provider (tests that do not care, or a non-TTY run) it does nothing.
export function useMouse(handler: (event: MouseEvent) => void): void {
  const source = useContext(MouseContext);
  useEffect(() => {
    if (!source) return;
    const listener = (event: MouseEvent) => handler(event);
    source.on("mouse", listener);
    return () => {
      source.off("mouse", listener);
    };
  }, [source, handler]);
}
