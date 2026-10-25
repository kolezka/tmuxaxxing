import { describe, expect, test } from "bun:test";

import { visibleRange } from "../../src/ui/window";

describe("visibleRange", () => {
  test.each([
    { total: 100, selected: 0, height: 10, expected: { start: 0, end: 10 } },
    { total: 5, selected: 4, height: 10, expected: { start: 0, end: 5 } },
  ])("returns $expected.start..$expected.end for $total rows", ({ total, selected, height, expected }) => {
    expect(visibleRange(total, selected, height)).toEqual(expected);
  });

  test("keeps the selected row inside the viewport", () => {
    const range = visibleRange(100, 50, 10);

    expect(range.start).toBeLessThanOrEqual(50);
    expect(range.end).toBeGreaterThan(50);
  });
});
