import {
  FOCUSED_TERMINAL_FRAME_INTERVAL_MS,
  terminalFrameIntervalMs,
} from "@/modules/terminal/ghostty/renderScheduling";

type Surface = { isFocused(): boolean };

/** What the runtime should do next to present the earliest dirty surface. */
export type FramePlan =
  | { readonly kind: "idle" }
  /** Request an animation frame now: its callback will find a surface due. */
  | { readonly kind: "frame" }
  /** Nothing can be due before this: sleep on a timer, then plan again. */
  | { readonly kind: "wait"; readonly delayMs: number };

const INTERACTION_PRIORITY_MS = 150;
/** Early arrival that still counts as on time (callback timestamps jitter by a fraction of a ms). */
const TOLERANCE_MS = 0.5;
const DEFAULT_REFRESH_MS = 1_000 / 60;
const MIN_REFRESH_MS = 4;
/** Callbacks further apart than this are not consecutive vsyncs of any display we care about. */
const MAX_REFRESH_SAMPLE_MS = 17.5;
/** A measured refresh interval is trusted this long without a new confirmation. */
const REFRESH_TTL_MS = 5_000;
/** The vsync phase learned from a callback stays usable this long (clocks drift apart slowly). */
const PHASE_TTL_MS = 1_000;

const isExact = (intervalMs: number): boolean =>
  intervalMs <= FOCUSED_TERMINAL_FRAME_INTERVAL_MS + 0.001;

/**
 * Per-pane frame rate limits plus one shared tick, so that waking the page costs once for all
 * panes instead of once per pane.
 *
 * A focused pane (and one the user is interacting with) runs at its own cadence: it presents
 * as soon as its interval allows. Every other pane waits for the end of the tick, a boundary of
 * its cadence on the one timeline all panes share, in which it became dirty. Four background
 * agents that each redraw a dozen times a second therefore wake the page at most once per tick
 * (30 or 15 times a second) instead of once per pane per redraw, and a pane that turns dirty
 * within one tick of another joins that pane's frame. A pane renders at most once per tick.
 *
 * The planner also knows the display: it asks for an animation frame only when the vsync that
 * callback will land on can serve the deadline, instead of burning one callback per vsync
 * until a pane is due (every other callback at 120 Hz, half of them for panes below 60 Hz).
 */
export class SurfaceFramePacer {
  private presentedAt = new WeakMap<Surface, number>();
  private interactiveUntil = new WeakMap<Surface, number>();
  private dirtyAt = new WeakMap<Surface, number>();
  private lastFrameAt: number | undefined;
  private refreshMs = DEFAULT_REFRESH_MS;
  private refreshAt = Number.NEGATIVE_INFINITY;
  private gestureValue = false;

  /**
   * A resize gesture (window edge, pane divider) is live: panes follow the layout on every
   * display refresh instead of at their own cadence, because a pane that redraws every other
   * refresh while its rectangle moves every refresh is the stutter people see.
   */
  setGesture(active: boolean): void {
    this.gestureValue = active;
  }

  interact(surface: Surface, now: number): void {
    this.interactiveUntil.set(surface, now + INTERACTION_PRIORITY_MS);
  }

  /** The surface has something new to draw; only the first notification since it last drew counts. */
  dirty(surface: Surface, now: number): void {
    if (!this.dirtyAt.has(surface)) this.dirtyAt.set(surface, now);
  }

  /** How long the surface has been waiting to draw what it last reported (undefined if nothing). */
  waited(surface: Surface, now: number): number | undefined {
    const since = this.dirtyAt.get(surface);
    return since === undefined ? undefined : Math.max(0, now - since);
  }

  /** The surface is being drawn (or found unchanged): later changes start a new wait. */
  settled(surface: Surface): void {
    this.dirtyAt.delete(surface);
  }

  presented(surface: Surface, now: number): void {
    this.presentedAt.set(surface, now);
    this.dirtyAt.delete(surface);
  }

  /** An animation frame callback ran at `frameAt`: learn the display's refresh interval and phase. */
  frameStarted(frameAt: number): void {
    const previous = this.lastFrameAt;
    this.lastFrameAt = frameAt;
    if (previous === undefined) return;
    const delta = frameAt - previous;
    if (delta < MIN_REFRESH_MS || delta > MAX_REFRESH_SAMPLE_MS) return;
    if (delta < this.refreshMs || frameAt - this.refreshAt > REFRESH_TTL_MS) {
      this.refreshMs = delta;
      this.refreshAt = frameAt;
    }
  }

  plan(
    surfaces: ReadonlySet<Surface>,
    windowFocused: boolean,
    now: number,
  ): FramePlan {
    let earliest = Number.POSITIVE_INFINITY;
    for (const surface of surfaces) {
      earliest = Math.min(earliest, this.deadline(surface, windowFocused, now));
    }
    if (earliest === Number.POSITIVE_INFINITY) return { kind: "idle" };
    const wait = earliest - now;
    if (wait <= TOLERANCE_MS) return { kind: "frame" };

    const refresh = this.currentRefresh(now);
    const last = this.lastFrameAt;
    if (last === undefined || now - last > PHASE_TTL_MS) {
      // Phase unknown: a callback lands somewhere within one refresh from now.
      return wait <= refresh
        ? { kind: "frame" }
        : { kind: "wait", delayMs: wait - refresh };
    }
    // A callback requested at t lands on the first vsync after t. Find the vsync that can serve
    // the deadline and ask for the callback only once it is the next one.
    const vsync =
      last + Math.ceil((earliest - TOLERANCE_MS - last) / refresh) * refresh;
    if (now >= vsync - refresh) return { kind: "frame" };
    return { kind: "wait", delayMs: vsync - refresh / 2 - now };
  }

  due(surface: Surface, windowFocused: boolean, now: number): boolean {
    return now + TOLERANCE_MS >= this.deadline(surface, windowFocused, now);
  }

  reset(): void {
    this.presentedAt = new WeakMap();
    this.interactiveUntil = new WeakMap();
    this.dirtyAt = new WeakMap();
    this.lastFrameAt = undefined;
    this.refreshMs = DEFAULT_REFRESH_MS;
    this.refreshAt = Number.NEGATIVE_INFINITY;
  }

  private currentRefresh(now: number): number {
    return now - this.refreshAt > REFRESH_TTL_MS
      ? Math.max(this.refreshMs, DEFAULT_REFRESH_MS)
      : this.refreshMs;
  }

  private deadline(
    surface: Surface,
    windowFocused: boolean,
    now: number,
  ): number {
    const last = this.presentedAt.get(surface);
    if (last === undefined) return Number.NEGATIVE_INFINITY;
    if (this.gestureValue) return last;
    const interval =
      now < (this.interactiveUntil.get(surface) ?? 0)
        ? FOCUSED_TERMINAL_FRAME_INTERVAL_MS
        : terminalFrameIntervalMs(windowFocused, surface.isFocused());
    const spaced = last + interval;
    const dirty = this.dirtyAt.get(surface);
    if (isExact(interval) || dirty === undefined) return spaced;
    // End of the tick in which the pane turned dirty, and not within half a tick of its last
    // frame (so a frame that landed late in its tick does not repeat at the next boundary).
    const tickEnd = (Math.floor(dirty / interval) + 1) * interval;
    const restedTick = Math.ceil((last + interval / 2) / interval - 1e-9);
    return Math.max(tickEnd, restedTick * interval);
  }
}
