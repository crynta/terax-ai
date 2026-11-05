import type { PtyColors } from "./pty-bridge";

/** Whether two themes paint and answer colour queries identically. */
export function sameTerminalColors(a: PtyColors, b: PtyColors): boolean {
  const same = (x: readonly number[], y: readonly number[]) =>
    x[0] === y[0] && x[1] === y[1] && x[2] === y[2];
  return (
    same(a.foreground, b.foreground) &&
    same(a.background, b.background) &&
    same(a.cursor, b.cursor) &&
    a.palette.length === b.palette.length &&
    a.palette.every((color, index) => same(color, b.palette[index]))
  );
}
