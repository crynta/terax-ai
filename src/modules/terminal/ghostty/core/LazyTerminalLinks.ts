import type { GhosttyTerminalModelApi } from "../GhosttyTerminalModel";
import type { LinkUnderlineGeometry } from "./LinkUnderlineOverlay";
import type { TerminalLinkHit } from "./terminalLinks";

export type LazyTerminalLinksOptions = {
  readonly target: HTMLElement;
  readonly keyTarget: Pick<Window, "addEventListener" | "removeEventListener">;
  /** Whether the platform's link modifier (Cmd, or Ctrl elsewhere) is down. */
  readonly isModifier: (event: {
    readonly metaKey: boolean;
    readonly ctrlKey: boolean;
  }) => boolean;
  readonly model: Pick<
    GhosttyTerminalModelApi,
    "linkSource" | "cols" | "rows" | "modes"
  >;
  /** The pane's scrollbar; the pointer over it belongs to the scrollbar. */
  readonly scrollbar: Node;
  readonly geometry: () => LinkUnderlineGeometry;
  readonly onActivate: (hit: TerminalLinkHit) => void;
};

/** What the lazily loaded link machinery offers its owner. */
export interface ActiveTerminalLinks {
  /** Takes over a pointer or key event that happened while this loaded. */
  ingest(event: Event): void;
  invalidate(): void;
  dispose(): void;
}

const MAX_QUEUED_EVENTS = 32;

/**
 * Link hover and activation, loaded on demand. A terminal that never sees the
 * link modifier pays for a few listeners; the detection, hit-testing,
 * underline and activation code arrives with the first modified pointer
 * movement, press or key press, and takes over the events that happened while
 * it loaded, so the first Cmd/Ctrl-click does not need a second one.
 */
export class LazyTerminalLinks {
  private active: ActiveTerminalLinks | null = null;
  private loading = false;
  private disposed = false;
  private keysBound = false;
  private hearingRelease = false;
  /** The latest pointer event over the pane; null once the pointer left. */
  private last: PointerEvent | null = null;
  private queue: Event[] = [];

  constructor(private readonly options: LazyTerminalLinksOptions) {
    const { target } = options;
    target.addEventListener("pointermove", this.handlePointer);
    target.addEventListener("pointerdown", this.handlePointer);
    target.addEventListener("pointerleave", this.handleLeave);
    target.addEventListener("pointercancel", this.handleLeave);
  }

  /** The cells under the pointer changed meaning (output, scroll). */
  invalidate(): void {
    this.active?.invalidate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    this.active?.dispose();
    this.active = null;
    this.last = null;
    this.queue = [];
  }

  private readonly handlePointer = (event: PointerEvent): void => {
    if (event.pointerType === "touch") return;
    if (event.type === "pointerdown" && event.button !== 0) return;
    this.last = event;
    if (this.loading) {
      this.enqueue(event);
      return;
    }
    this.bindKeys();
    if (this.options.isModifier(event)) void this.load([event]);
  };

  private readonly handleRelease = (event: PointerEvent): void => {
    if (event.button === 0 && this.last) this.enqueue(event);
  };

  private readonly handleKey = (event: KeyboardEvent): void => {
    if (!this.last) return;
    if (this.loading) {
      this.enqueue(event);
    } else if (this.options.isModifier(event)) {
      void this.load([this.last, event]);
    }
  };

  private readonly handleLeave = (): void => {
    // Nothing that happened before the pointer left is worth replaying, and a
    // key press elsewhere must not load links for a pane it is not over.
    this.last = null;
    this.queue.length = 0;
    this.unbindKeys();
  };

  private enqueue(event: Event): void {
    const queue = this.queue;
    if (
      event.type === "pointermove" &&
      queue[queue.length - 1]?.type === "pointermove"
    ) {
      queue[queue.length - 1] = event;
      return;
    }
    queue.push(event);
    if (queue.length > MAX_QUEUED_EVENTS) queue.shift();
  }

  private bindKeys(): void {
    if (this.keysBound) return;
    this.keysBound = true;
    this.options.keyTarget.addEventListener("keydown", this.handleKey);
  }

  private unbindKeys(): void {
    if (!this.keysBound) return;
    this.keysBound = false;
    this.options.keyTarget.removeEventListener("keydown", this.handleKey);
  }

  /** Releases are only worth hearing while a press may be waiting for the code. */
  private listenForRelease(listen: boolean): void {
    if (listen === this.hearingRelease) return;
    this.hearingRelease = listen;
    const { target, keyTarget } = this.options;
    if (listen) {
      target.addEventListener("pointerup", this.handleRelease);
      keyTarget.addEventListener("keyup", this.handleKey);
    } else {
      target.removeEventListener("pointerup", this.handleRelease);
      keyTarget.removeEventListener("keyup", this.handleKey);
    }
  }

  private detach(): void {
    const { target } = this.options;
    target.removeEventListener("pointermove", this.handlePointer);
    target.removeEventListener("pointerdown", this.handlePointer);
    target.removeEventListener("pointerleave", this.handleLeave);
    target.removeEventListener("pointercancel", this.handleLeave);
    this.unbindKeys();
    this.listenForRelease(false);
  }

  private async load(seed: Event[]): Promise<void> {
    if (this.active || this.loading || this.disposed) return;
    this.loading = true;
    this.queue = seed;
    this.listenForRelease(true);
    try {
      const { createTerminalLinks } = await import("./terminalLinksRuntime");
      if (this.disposed) return;
      const active = createTerminalLinks(this.options);
      this.active = active;
      const pending = this.queue;
      this.detach();
      this.last = null;
      for (const event of pending) active.ingest(event);
    } catch (error) {
      console.error("[terax] terminal link support failed to load:", error);
    } finally {
      this.loading = false;
      this.queue = [];
      if (!this.active) this.listenForRelease(false);
    }
  }
}
