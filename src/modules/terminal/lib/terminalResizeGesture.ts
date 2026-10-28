import {
  beginTerminalResizeInteraction,
  endTerminalResizeInteraction,
  subscribeTerminalResizeInteraction,
  terminalResizeInteractionActive,
} from "./terminalResizeInteraction";

/**
 * Detects window and layout drags for renderers. Pane dividers announce themselves through
 * `terminalResizeInteraction`; a native window announces a live resize where the OS can say
 * so (macOS today). Everything else (Windows and Linux windows, animated sidebars) shows up
 * only as layout changes, so a burst of host size changes is itself treated as a gesture:
 * the same surface resizing twice less than `GESTURE_GAP_MS` apart starts one, and it ends
 * after that long without a change. Several surfaces laying out once each (a tab switch) is
 * not a burst.
 *
 * A native live resize is trusted only while the window keeps resizing: if its end signal
 * is ever lost, the claim goes stale (`NATIVE_STALE_MS` without a host resize) instead of
 * holding every later resize for the interaction watchdog.
 */
export const GESTURE_GAP_MS = 150;
/** A native live resize with no host resize for this long is taken as ended or lost. */
export const NATIVE_STALE_MS = 2_000;

const NATIVE_TOKEN = {};
const BURST_TOKEN = {};

let nativeActive = false;
let nativeSignalAt = Number.NEGATIVE_INFINITY;
let burstActive = false;
let burstTimer: ReturnType<typeof setTimeout> | null = null;
let lastChangeAt = Number.NEGATIVE_INFINITY;
let clock: () => number = () => performance.now();
let lastBySurface = new WeakMap<object, number>();
let lastInteractionEndAt = Number.NEGATIVE_INFINITY;

subscribeTerminalResizeInteraction((active) => {
  if (!active) lastInteractionEndAt = clock();
});

/** The window reports that the user started or stopped dragging its edge or corner. */
export function setNativeLiveResize(active: boolean): void {
  if (active) nativeSignalAt = clock();
  if (active === nativeActive) return;
  nativeActive = active;
  if (active) beginTerminalResizeInteraction(NATIVE_TOKEN);
  else endTerminalResizeInteraction(NATIVE_TOKEN);
}

/** A surface saw its host change size. Cheap: no timers are created per call. */
export function noteTerminalHostResize(surface: object): void {
  const now = clock();
  const previous = lastBySurface.get(surface);
  lastBySurface.set(surface, now);
  if (nativeActive && now - nativeSignalAt > NATIVE_STALE_MS) {
    // The window claims a live resize but has been quiet for longer than any drag pauses:
    // its end signal was lost. Without this every later resize would be held.
    nativeActive = false;
    endTerminalResizeInteraction(NATIVE_TOKEN);
  }
  // Keep the interaction's watchdog (30 s) from ending a drag that is still going.
  if (nativeActive) {
    nativeSignalAt = now;
    beginTerminalResizeInteraction(NATIVE_TOKEN);
  }
  if (burstActive) {
    lastChangeAt = now;
    beginTerminalResizeInteraction(BURST_TOKEN);
    return;
  }
  // A pointer drag or a native live resize already says when it ends; waiting for a quiet
  // period after it would only delay the final size.
  // The layout that lands in the frame after the release is the end of that drag, not a new one.
  if (
    terminalResizeInteractionActive() ||
    clock() - lastInteractionEndAt < GESTURE_GAP_MS
  )
    return;
  if (previous === undefined || now - previous > GESTURE_GAP_MS) return;
  burstActive = true;
  lastChangeAt = now;
  beginTerminalResizeInteraction(BURST_TOKEN);
  armBurstTimer(GESTURE_GAP_MS);
}

function armBurstTimer(delay: number): void {
  burstTimer = globalThis.setTimeout(() => {
    burstTimer = null;
    const quiet = clock() - lastChangeAt;
    if (quiet < GESTURE_GAP_MS) {
      armBurstTimer(GESTURE_GAP_MS - quiet);
      return;
    }
    burstActive = false;
    endTerminalResizeInteraction(BURST_TOKEN);
  }, delay);
}

/** Test seam: resets module state and replaces the clock. */
export function resetTerminalResizeGestureForTest(now?: () => number): void {
  if (burstTimer !== null) globalThis.clearTimeout(burstTimer);
  burstTimer = null;
  if (burstActive) endTerminalResizeInteraction(BURST_TOKEN);
  burstActive = false;
  if (nativeActive) endTerminalResizeInteraction(NATIVE_TOKEN);
  nativeActive = false;
  nativeSignalAt = Number.NEGATIVE_INFINITY;
  lastChangeAt = Number.NEGATIVE_INFINITY;
  lastBySurface = new WeakMap();
  lastInteractionEndAt = Number.NEGATIVE_INFINITY;
  clock = now ?? (() => performance.now());
}
