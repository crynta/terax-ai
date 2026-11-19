/** The grid cell for fractional cell coordinates, or null outside the grid. */
export function cellAtPoint(
  column: number,
  row: number,
  cols: number,
  rows: number,
): { readonly row: number; readonly column: number } | null {
  const c = Math.floor(column);
  const r = Math.floor(row);
  if (!(c >= 0 && c < cols && r >= 0 && r < rows)) return null;
  return { row: r, column: c };
}
