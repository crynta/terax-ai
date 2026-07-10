const MAX_SCAN_LINES = 1000;

// Histogram of positive indent-width deltas between consecutive lines; the
// most common step is the indent unit (VS Code style heuristic).
export function detectIndentUnit(text: string, fallback = "  "): string {
  let tabLines = 0;
  let spaceLines = 0;
  const deltas = new Map<number, number>();
  let prevWidth = 0;
  let scanned = 0;

  for (let start = 0; start < text.length && scanned < MAX_SCAN_LINES; ) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    scanned += 1;

    const first = text.charCodeAt(start);
    if (first === 9) {
      tabLines += 1;
    } else if (first === 32) {
      let w = 0;
      while (start + w < end && text.charCodeAt(start + w) === 32) w += 1;
      if (start + w < end) {
        spaceLines += 1;
        const delta = w - prevWidth;
        if (delta >= 2 && delta <= 8) {
          deltas.set(delta, (deltas.get(delta) ?? 0) + 1);
        }
        prevWidth = w;
      }
    } else if (start !== end) {
      prevWidth = 0;
    }
    start = end + 1;
  }

  if (tabLines > spaceLines) return "\t";
  if (spaceLines === 0) return fallback;

  let best = 0;
  let bestCount = 0;
  for (const [delta, count] of deltas) {
    if (count > bestCount || (count === bestCount && delta < best)) {
      best = delta;
      bestCount = count;
    }
  }
  return best > 0 ? " ".repeat(best) : fallback;
}
