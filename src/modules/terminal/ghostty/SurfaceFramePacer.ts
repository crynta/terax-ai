import {
  FOCUSED_TERMINAL_FRAME_INTERVAL_MS,
  terminalFrameIntervalMs,
} from "@/modules/terminal/ghostty/renderScheduling";

type Surface = { isFocused(): boolean };
const FRAME_LEAD_MS = 1_000 / 60;
const INTERACTION_PRIORITY_MS = 150;

export class SurfaceFramePacer {
  private presentedAt = new WeakMap<Surface, number>();
  private interactiveUntil = new WeakMap<Surface, number>();

  interact(surface: Surface, now: number): void {
    this.interactiveUntil.set(surface, now + INTERACTION_PRIORITY_MS);
  }

  delay(
    surfaces: ReadonlySet<Surface>,
    windowFocused: boolean,
    now: number,
  ): number {
    let earliest = Number.POSITIVE_INFINITY;
    for (const surface of surfaces) {
      earliest = Math.min(earliest, this.deadline(surface, windowFocused, now));
    }
    return Math.max(0, earliest - now - FRAME_LEAD_MS);
  }

  due(surface: Surface, windowFocused: boolean, now: number): boolean {
    return now + 0.1 >= this.deadline(surface, windowFocused, now);
  }

  presented(surface: Surface, now: number): void {
    this.presentedAt.set(surface, now);
  }

  reset(): void {
    this.presentedAt = new WeakMap();
    this.interactiveUntil = new WeakMap();
  }

  private deadline(
    surface: Surface,
    windowFocused: boolean,
    now: number,
  ): number {
    const last = this.presentedAt.get(surface);
    const interval =
      now < (this.interactiveUntil.get(surface) ?? 0)
        ? FOCUSED_TERMINAL_FRAME_INTERVAL_MS
        : terminalFrameIntervalMs(windowFocused, surface.isFocused());
    return last === undefined ? Number.NEGATIVE_INFINITY : last + interval;
  }
}
