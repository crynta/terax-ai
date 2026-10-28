export type CssSize = { readonly width: number; readonly height: number };

export type GestureBackingEnvironment = {
  /** The surface's host box now, in CSS pixels. */
  readonly host: CssSize;
  readonly scale: number;
  /**
   * The window's inner size differs from what it was when the gesture began: the window itself
   * is being dragged, so panes can grow by what the screen leaves it.
   */
  readonly windowResized: boolean;
  /** The terminal area the panes share; null when it cannot be found. */
  readonly area: CssSize | null;
  /** The window's inner size and the screen space available to it. */
  readonly windowInner: CssSize;
  readonly screenAvailable: CssSize;
  /** Largest texture dimension the device allows. */
  readonly maxDimension: number;
};

/**
 * The largest backing store (device pixels) a surface can need before the gesture ends. A
 * surface that outgrows its backing during a drag allocates once to this bound rather than
 * step by step, because WebKit keeps every swapchain a resizing canvas retired until the drag
 * ends (about 30 MiB for a 2000x1300 canvas, per step).
 *
 * - Window drag: no pane can grow by more than the window does, and the window cannot grow
 *   past the screen. When the window already fills the screen there is no room to grow.
 * - Anything else (a pane divider, an animated sidebar): the window keeps its size, so a pane
 *   cannot outgrow the terminal area (or, failing that, the window).
 */
export function gestureBackingBound(environment: GestureBackingEnvironment): {
  readonly width: number;
  readonly height: number;
} {
  const { host, scale } = environment;
  let width = finite(host.width);
  let height = finite(host.height);
  if (environment.windowResized) {
    // An unreadable screen or window size means "no known room to grow".
    width += room(
      environment.screenAvailable.width,
      environment.windowInner.width,
    );
    height += room(
      environment.screenAvailable.height,
      environment.windowInner.height,
    );
  } else {
    const area = environment.area ?? environment.windowInner;
    width = Math.max(width, finite(area.width));
    height = Math.max(height, finite(area.height));
  }
  const limit = Math.max(1, Math.floor(finite(environment.maxDimension) || 1));
  return {
    width: Math.min(limit, Math.ceil(width * scale)),
    height: Math.min(limit, Math.ceil(height * scale)),
  };
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function room(screenSize: number, windowSize: number): number {
  return Math.max(0, finite(screenSize - windowSize));
}

/** The window's inner size; compared between the start of a gesture and the moment it must grow. */
export function windowInnerSize(): CssSize {
  return typeof window === "undefined"
    ? { width: 0, height: 0 }
    : { width: window.innerWidth, height: window.innerHeight };
}

/** Reads the browser state `gestureBackingBound` needs; only called when a surface must grow. */
export function measureGestureBackingEnvironment(
  host: HTMLElement,
  gestureStartInner: CssSize,
  scale: number,
  maxDimension: number,
): GestureBackingEnvironment {
  const rect = host.getBoundingClientRect();
  const area = host.closest?.("[data-terminal-tab]");
  const windowInner = windowInnerSize();
  const screenInfo = typeof screen === "undefined" ? null : screen;
  return {
    host: { width: rect.width, height: rect.height },
    scale,
    windowResized:
      windowInner.width !== gestureStartInner.width ||
      windowInner.height !== gestureStartInner.height,
    area: area ? { width: area.clientWidth, height: area.clientHeight } : null,
    windowInner,
    screenAvailable: {
      width: screenInfo?.availWidth || windowInner.width,
      height: screenInfo?.availHeight || windowInner.height,
    },
    maxDimension,
  };
}
