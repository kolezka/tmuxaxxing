export function visibleRange(
  total: number,
  selected: number,
  height: number,
): { start: number; end: number } {
  const rowCount = Math.max(0, Math.floor(total));
  const windowHeight = Math.max(0, Math.floor(height));

  if (rowCount === 0 || windowHeight === 0) {
    return { start: 0, end: 0 };
  }

  const size = Math.min(rowCount, windowHeight);
  const selectedRow = Math.min(Math.max(0, Math.floor(selected)), rowCount - 1);
  const start = Math.min(
    Math.max(0, selectedRow - Math.floor(size / 2)),
    rowCount - size,
  );

  return { start, end: start + size };
}
