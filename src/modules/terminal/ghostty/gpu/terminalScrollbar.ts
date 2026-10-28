import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";

/** Pinned-to-bottom growth moves the thumb at most this often. */
const PINNED_WRITE_INTERVAL_MS = 100;
/** Accessibility values change at most four times per second. */
const ARIA_INTERVAL_MS = 250;

/**
 * A scroll event that echoes our own write: the browser clamped the `scrollTop` we set to the
 * extent the content has now, because the scrollback shrank (Ghostty prunes whole pages). It
 * reports where the browser put the thumb, not where the user dragged it, and must not move the
 * model: with history one line longer by the time it was delivered the clamped position read as
 * "scrolled up one line", which left the view anchored above the bottom for good while output
 * streamed on.
 */
export function isClampedScrollEcho(
  written: number | null,
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  const max = scrollHeight - clientHeight;
  return (
    written !== null && written > max + 1 && Math.abs(scrollTop - max) <= 1
  );
}

export type ScrollbarClock = {
  now(): number;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
};

const browserClock: ScrollbarClock = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

type Binding = {
  readonly scrollbar: HTMLElement;
  readonly content: HTMLElement;
  readonly model: GhosttyTerminalModelApi;
  readonly viewportHeight: number;
  readonly cellHeight: number;
};

/**
 * Keeps the native scrollbar proxy in step with the model. It never reads the
 * DOM while syncing: the last value written to `scrollTop` (or reported by the
 * scroll handler, which is allowed to read) lives in JavaScript. Writing
 * `scrollTop` forces a layout in browsers, so while output grows history under
 * a bottom-pinned view the thumb moves at most ten times a second.
 */
export class TerminalScrollbarSync {
  private history = -1;
  private offset = -1;
  private cellHeight = 0;
  private viewportHeight = 0;
  private available = false;
  private position: number | null = null;
  private appliedScrollTop = Number.NaN;
  private appliedOffset = -1;
  private appliedHeight = "";
  private appliedVisibility = "";
  private lastWriteAt = Number.NEGATIVE_INFINITY;
  private trailingTimer: number | null = null;
  private binding: Binding | null = null;
  private ariaMax = "";
  private ariaNow = "";
  private ariaWritten = false;
  private ariaDirty = false;
  private lastAriaAt = Number.NEGATIVE_INFINITY;
  private ariaTimer: number | null = null;
  private ariaTarget: HTMLElement | null = null;

  constructor(private readonly clock: ScrollbarClock = browserClock) {}

  /** The scroll position the DOM holds, as far as JavaScript knows. */
  get writtenScrollTop(): number | null {
    return Number.isNaN(this.appliedScrollTop) ? null : this.appliedScrollTop;
  }

  /** Re-checks geometry on the next sync; the DOM keeps its scroll position. */
  invalidate(): void {
    this.history = -1;
  }

  /** The element was re-attached, so the browser reset its scroll position. */
  forget(): void {
    this.history = -1;
    this.appliedScrollTop = Number.NaN;
    this.appliedOffset = -1;
  }

  /** Records a position the user produced; the scroll handler read it. */
  observe(scrollTop: number): void {
    this.appliedScrollTop = scrollTop;
    this.position = scrollTop;
  }

  sync(
    viewportHeight: number,
    scrollbar: HTMLElement,
    content: HTMLElement,
    model: GhosttyTerminalModelApi,
    cellHeight: number,
  ): number | null {
    const { history, offset } = model.scrollPosition();
    const available = history > 0 && !model.modes().alternateScreen;
    if (
      history === this.history &&
      offset === this.offset &&
      available === this.available &&
      cellHeight === this.cellHeight &&
      viewportHeight === this.viewportHeight
    )
      return this.position;
    const geometryChanged =
      cellHeight !== this.cellHeight ||
      viewportHeight !== this.viewportHeight ||
      available !== this.available;
    this.history = history;
    this.offset = offset;
    this.available = available;
    this.cellHeight = cellHeight;
    this.viewportHeight = viewportHeight;
    this.binding = { scrollbar, content, model, viewportHeight, cellHeight };

    this.queueAria(scrollbar, history, offset);
    this.apply(this.binding, history, offset, available, geometryChanged);
    return this.position;
  }

  dispose(): void {
    this.cancelTrailing();
    if (this.ariaTimer !== null) this.clock.clearTimeout(this.ariaTimer);
    this.ariaTimer = null;
    this.ariaTarget = null;
    this.binding = null;
  }

  private apply(
    binding: Binding,
    history: number,
    offset: number,
    available: boolean,
    geometryChanged: boolean,
  ): void {
    const { scrollbar, content, viewportHeight, cellHeight } = binding;
    const visibility = available ? "visible" : "hidden";
    if (visibility !== this.appliedVisibility) {
      scrollbar.style.visibility = visibility;
      this.appliedVisibility = visibility;
    }
    if (!available) {
      this.position = null;
      this.cancelTrailing();
      return;
    }

    const height = `${viewportHeight + history * cellHeight}px`;
    if (height !== this.appliedHeight) {
      content.style.height = height;
      this.appliedHeight = height;
    }
    const line = history - offset;
    const aligned =
      !Number.isNaN(this.appliedScrollTop) &&
      Math.round(this.appliedScrollTop / cellHeight) === line;
    if (aligned) {
      this.position = this.appliedScrollTop;
      this.appliedOffset = offset;
      this.cancelTrailing();
      return;
    }

    const pinned = offset === 0 && this.appliedOffset === 0 && !geometryChanged;
    const now = this.clock.now();
    if (pinned && now - this.lastWriteAt < PINNED_WRITE_INTERVAL_MS) {
      this.scheduleTrailing(
        PINNED_WRITE_INTERVAL_MS - (now - this.lastWriteAt),
      );
      return;
    }
    this.cancelTrailing();
    const target = line * cellHeight;
    scrollbar.scrollTop = target;
    this.appliedScrollTop = target;
    this.appliedOffset = offset;
    this.position = target;
    this.lastWriteAt = now;
  }

  private scheduleTrailing(delay: number): void {
    if (this.trailingTimer !== null) return;
    this.trailingTimer = this.clock.setTimeout(
      () => {
        this.trailingTimer = null;
        const binding = this.binding;
        if (!binding) return;
        // Read the model again. The values this class holds can be gone: the scroll handler
        // invalidates them, and a write derived from that placeholder (history -1) put
        // `scrollTop` at a negative line, which the browser clamped to the top and the handler
        // then took for the user dragging the view there.
        this.history = -1;
        this.sync(
          binding.viewportHeight,
          binding.scrollbar,
          binding.content,
          binding.model,
          binding.cellHeight,
        );
      },
      Math.max(1, delay),
    );
  }

  private cancelTrailing(): void {
    if (this.trailingTimer !== null)
      this.clock.clearTimeout(this.trailingTimer);
    this.trailingTimer = null;
  }

  private queueAria(
    scrollbar: HTMLElement,
    history: number,
    offset: number,
  ): void {
    this.ariaTarget = scrollbar;
    const max = String(history);
    const now = String(history - offset);
    if (max === this.ariaMax && now === this.ariaNow && this.ariaWritten) {
      return;
    }
    this.ariaMax = max;
    this.ariaNow = now;
    this.ariaDirty = true;
    const elapsed = this.clock.now() - this.lastAriaAt;
    if (!this.ariaWritten || elapsed >= ARIA_INTERVAL_MS) {
      this.flushAria();
      return;
    }
    if (this.ariaTimer === null) {
      this.ariaTimer = this.clock.setTimeout(() => {
        this.ariaTimer = null;
        this.flushAria();
      }, ARIA_INTERVAL_MS - elapsed);
    }
  }

  private flushAria(): void {
    const target = this.ariaTarget;
    if (!target || !this.ariaDirty) return;
    this.ariaDirty = false;
    this.lastAriaAt = this.clock.now();
    if (!this.ariaWritten) target.setAttribute("aria-valuemin", "0");
    this.ariaWritten = true;
    target.setAttribute("aria-valuemax", this.ariaMax);
    target.setAttribute("aria-valuenow", this.ariaNow);
  }
}
