/**
 * Tells a pointer the user moved from one a list scrolled under. Browsers
 * report the row now beneath a resting pointer (`mouseenter`, and a synthetic
 * `mousemove` at the same position) whenever content moves, so a hover that
 * selects rows undoes every keyboard step that scrolls the list. The first
 * position seen is the baseline; only a different one is intent.
 */
export function createPointerIntent(): (x: number, y: number) => boolean {
  let baseline: { x: number; y: number } | null = null;
  return (x, y) => {
    if (baseline === null) {
      baseline = { x, y };
      return false;
    }
    if (baseline.x === x && baseline.y === y) return false;
    baseline = { x, y };
    return true;
  };
}
