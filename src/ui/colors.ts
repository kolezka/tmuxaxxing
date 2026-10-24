import type { Color } from "../feed/schema";

const colors: Record<Color, string> = {
  work: "yellow",
  ask: "magenta",
  done: "green",
  error: "red",
  dim: "gray",
  info: "blue",
};

export function inkColor(color?: Color): string {
  return color ? colors[color] : "white";
}
