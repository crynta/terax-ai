// Page tiles during a window drag (WebKit / macOS).
//
// WebKit paints the page into one tile that follows the viewport while the
// window is being dragged, so every step allocates a new viewport-sized
// IOSurface (about 17 MiB at 1280x820 @2x) and the old ones are only
// reclaimed after the drag ends: an empty page peaks at several hundred MiB.
// Giving the document a scrollable size rounded up to a multiple of the tile
// quantum (see `html[data-live-resize]` in globals.css) keeps that tile the
// same size from step to step, so its buffers are reused and the cost is one
// reallocation per quantum crossed instead of one per step.
//
// The extra size is only requested while a drag is in progress, so a window at
// rest keeps WebKit's own tiling. A drag is a burst of `resize` events; it
// ends after `LIVE_RESIZE_IDLE_MS` without one.

export const LIVE_RESIZE_ATTR = "data-live-resize";
export const LIVE_RESIZE_IDLE_MS = 250;

type Unsubscribe = () => void;

export type LivePageResizeSources = {
  root: Pick<Element, "setAttribute" | "removeAttribute">;
  onResize: (listener: () => void) => Unsubscribe;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

/**
 * Keeps `data-live-resize` on `root` while resize events keep arriving. One
 * timer is re-armed per event only when the burst is already running, so the
 * work per step is a single timer swap.
 */
export function installLivePageResize(
  sources: LivePageResizeSources,
  idleMs = LIVE_RESIZE_IDLE_MS,
): Unsubscribe {
  let active = false;
  let timer: unknown = null;

  const end = () => {
    timer = null;
    active = false;
    sources.root.removeAttribute(LIVE_RESIZE_ATTR);
  };
  const stopListening = sources.onResize(() => {
    if (!active) {
      active = true;
      sources.root.setAttribute(LIVE_RESIZE_ATTR, "");
    }
    if (timer !== null) sources.clearTimer(timer);
    timer = sources.setTimer(end, idleMs);
  });

  return () => {
    stopListening();
    if (timer !== null) sources.clearTimer(timer);
    timer = null;
    if (active) sources.root.removeAttribute(LIVE_RESIZE_ATTR);
    active = false;
  };
}

/** Browser wiring of `installLivePageResize`. */
export function installLivePageResizeInBrowser(): Unsubscribe {
  return installLivePageResize({
    root: document.documentElement,
    onResize: (listener) => {
      window.addEventListener("resize", listener, { passive: true });
      return () => window.removeEventListener("resize", listener);
    },
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  });
}
