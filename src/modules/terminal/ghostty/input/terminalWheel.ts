/** `WheelEvent.deltaMode` values (the constants are not available in Node). */
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

/**
 * A browser event can carry any distance (a synthetic 2000 px, an inertial
 * flick), but a program on the other side of the PTY has to read every report
 * or arrow it is sent. Excess beyond this is dropped, never queued.
 */
export const MAX_WHEEL_REPORTS_PER_EVENT = 10;

export const DEFAULT_SCROLL_SPEED = 1;
export const MIN_SCROLL_SPEED = 0.1;
export const MAX_SCROLL_SPEED = 10;

export function clampScrollSpeed(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    return DEFAULT_SCROLL_SPEED;
  const clamped = Math.min(MAX_SCROLL_SPEED, Math.max(MIN_SCROLL_SPEED, value));
  return Math.round(clamped * 100) / 100;
}

/**
 * Signed distance in text lines (positive scrolls toward newer output) that a
 * wheel event asks for, scaled by the scroll speed preference. Non-finite
 * input counts as no motion.
 */
export function wheelLines(
  deltaY: number,
  deltaMode: number,
  cellHeight: number,
  rows: number,
  speed: number,
): number {
  if (!Number.isFinite(deltaY) || !Number.isFinite(speed)) return 0;
  const lines =
    deltaMode === DOM_DELTA_LINE
      ? deltaY
      : deltaMode === DOM_DELTA_PAGE
        ? deltaY * rows
        : deltaY / Math.max(1, cellHeight);
  return lines * speed;
}

export type WheelRoute =
  /** Mouse wheel reports to an application that tracks the mouse. */
  | "report"
  /** Cursor keys: xterm's alternate scroll mode (DEC 1007) on the alternate screen. */
  | "arrows"
  /** The terminal's own scrollback. */
  | "scrollback";

export type WheelState = {
  readonly mouseTracking: boolean;
  readonly shiftKey: boolean;
  readonly alternateScreen: boolean;
  /** DEC private mode 1007. */
  readonly alternateScroll: boolean;
};

/**
 * Shift hands the wheel back to the terminal, as for selection: it bypasses
 * mouse tracking and then follows the same rules as an application that does
 * not track the mouse. The alternate screen has no scrollback, so with
 * alternate scroll on the wheel becomes cursor keys there and otherwise has
 * nothing to scroll.
 */
export function wheelRoute(state: WheelState): WheelRoute {
  if (state.mouseTracking && !state.shiftKey) return "report";
  if (state.alternateScreen && state.alternateScroll) return "arrows";
  return "scrollback";
}

/**
 * Turns fractional line motion into whole lines. The remainder survives
 * between events (trackpads send many tiny ones), is dropped when the
 * direction reverses (a quick back-flick must not first pay off the old
 * motion) or the route changes, and never grows past a line.
 */
export class WheelAccumulator {
  private remainder = 0;
  private route: WheelRoute | null = null;

  push(route: WheelRoute, lines: number, maxLines = Infinity): number {
    if (route !== this.route) {
      this.route = route;
      this.remainder = 0;
    }
    if (!Number.isFinite(lines) || lines === 0) return 0;
    if (Math.sign(lines) !== Math.sign(this.remainder)) this.remainder = 0;
    this.remainder += lines;
    const whole = Math.trunc(this.remainder) || 0;
    this.remainder -= whole;
    return Math.max(-maxLines, Math.min(maxLines, whole));
  }

  reset(): void {
    this.remainder = 0;
    this.route = null;
  }
}

export function cursorKeySequence(
  direction: "up" | "down",
  applicationCursorKeys: boolean,
): string {
  const final = direction === "up" ? "A" : "B";
  return applicationCursorKeys ? `\x1bO${final}` : `\x1b[${final}`;
}
