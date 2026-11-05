type Point = { x: number; y: number };

let lastSeen: Point | null = null;
let tracking = false;

/**
 * Remembers where the pointer last was anywhere in the document, so a list
 * that opens under it, or that it enters in a single event, can tell the two
 * apart. Installed once, on first use.
 */
export function trackPointer(): void {
  if (tracking || typeof document === "undefined") return;
  tracking = true;
  document.addEventListener(
    "mousemove",
    (event) => {
      lastSeen = { x: event.clientX, y: event.clientY };
    },
    { passive: true },
  );
}

/**
 * Tells a pointer the user moved from one a list scrolled under. Browsers
 * report the row now beneath a resting pointer (`mouseenter`, and a synthetic
 * `mousemove` at the same position) whenever content moves, so a hover that
 * selects rows undoes every keyboard step that scrolls the list. The baseline
 * is where the pointer was last seen (the position of the first event when it
 * was never seen); only a different position is intent.
 */
export function createPointerIntent(
  seed: Point | null = lastSeen,
): (x: number, y: number) => boolean {
  let baseline = seed;
  return (x, y) => {
    const previous = baseline;
    baseline = { x, y };
    return previous !== null && (previous.x !== x || previous.y !== y);
  };
}
