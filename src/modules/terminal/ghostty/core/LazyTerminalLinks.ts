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
  readonly model: Pick<GhosttyTerminalModelApi, "linkSource" | "cols" | "rows" | "modes">;
  /** The pane's scrollbar; the pointer over it belongs to the scrollbar. */
  readonly scrollbar: Node;
  readonly geometry: () => LinkUnderlineGeometry;
  readonly onActivate: (hit: TerminalLinkHit) => void;
};

/** What the lazily loaded link machinery offers its owner. */
export interface ActiveTerminalLinks {
  ingest(event: PointerEvent): void;
  invalidate(): void;
  dispose(): void;
}

/**
 * Link hover and activation, loaded on demand. A terminal that never sees the
 * link modifier pays for two listeners; the detection, hit-testing, underline
 * and activation code arrives with the first pointer movement or key press
 * while the modifier is held.
 */
export class LazyTerminalLinks {
  private active: ActiveTerminalLinks | null = null;
  private loading = false;
  private disposed = false;
  private keysBound = false;
  private last: PointerEvent | null = null;

  constructor(private readonly options: LazyTerminalLinksOptions) {
    options.target.addEventListener("pointermove", this.handleMove);
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
  }

  private readonly handleMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch") return;
    this.last = event;
    if (this.options.isModifier(event)) {
      void this.load();
      return;
    }
    if (this.keysBound) return;
    this.keysBound = true;
    this.options.keyTarget.addEventListener("keydown", this.handleKey);
  };

  private readonly handleKey = (event: KeyboardEvent): void => {
    if (this.last && this.options.isModifier(event)) void this.load();
  };

  private detach(): void {
    this.options.target.removeEventListener("pointermove", this.handleMove);
    if (this.keysBound) {
      this.keysBound = false;
      this.options.keyTarget.removeEventListener("keydown", this.handleKey);
    }
  }

  private async load(): Promise<void> {
    if (this.active || this.loading || this.disposed) return;
    this.loading = true;
    try {
      const { createTerminalLinks } = await import("./terminalLinksRuntime");
      if (this.disposed) return;
      this.active = createTerminalLinks(this.options);
      this.detach();
      if (this.last) this.active.ingest(this.last);
    } catch (error) {
      console.error("[terax] terminal link support failed to load:", error);
    } finally {
      this.loading = false;
    }
  }
}
