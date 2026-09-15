export function changedTerminalText(previous: string, next: string): string {
  if (!previous) return next.slice(-2048);
  if (next === previous) return "";
  let common = 0;
  while (
    common < previous.length &&
    common < next.length &&
    previous[common] === next[common]
  )
    common++;
  if (common > 0) return next.slice(Math.max(common, next.length - 2048));
  const oldLines = previous.split("\n").slice(-128);
  const newLines = next.split("\n").slice(-128);
  for (
    let overlap = Math.min(oldLines.length, newLines.length);
    overlap > 0;
    overlap--
  ) {
    if (
      oldLines.slice(-overlap).join("\n") ===
      newLines.slice(0, overlap).join("\n")
    )
      return newLines.slice(overlap).join("\n").slice(-2048);
  }
  return next.slice(-2048);
}
