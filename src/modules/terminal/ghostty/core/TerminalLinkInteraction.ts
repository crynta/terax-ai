import type { TerminalLinkHit } from "./terminalLinks";

export type LinkCell = { readonly row: number; readonly column: number };

export interface LinkOverlay {
  show(hit: TerminalLinkHit): void;
  hide(): void;
}

export type TerminalLinkInteractionOptions = {
  readonly target: HTMLElement;
  readonly keyTarget: Pick<Window, "addEventListener" | "removeEventListener">;
  /** Whether the platform's link modifier (Cmd, or Ctrl elsewhere) is down. */
  readonly isModifier: (event: {
    readonly metaKey: boolean;
    readonly ctrlKey: boolean;
  }) => boolean;
  /** The grid cell under a client point, or null outside the grid. */
  readonly cellAt: (clientX: number, clientY: number) => LinkCell | null;
  /** True when the pointer belongs to something else (scrollbar, mouse-tracking app). */
  readonly blocked: (shift: boolean, target: EventTarget | null) => boolean;
  readonly hitAt: (cell: LinkCell) => TerminalLinkHit | null;
  readonly overlay: LinkOverlay;
  readonly setPointerCursor: (pointer: boolean) => void;
  readonly onActivate: (hit: TerminalLinkHit) => void;
  readonly schedule?: (callback: () => void) => void;
};

type Pointer = {
  x: number;
  y: number;
  shift: boolean;
  modifier: boolean;
  target: EventTarget | null;
};

/**
 * Link hover and activation for one terminal surface. Links only react while
 * the platform modifier is held, so a plain click keeps selecting text, and a
 * pointer without the modifier costs nothing: no layout read, no model read.
 *
 * Activation uses pointer events. The selection controller cancels
 * `pointerdown`, and browsers then suppress the compatibility `mousedown` and
 * `mouseup` events, so mouse listeners never see a primary-button click.
 */
export class TerminalLinkInteraction {
  private pointer: Pointer | null = null;
  private hit: TerminalLinkHit | null = null;
  private cellKey = -1;
  private down: TerminalLinkHit | null = null;
  private keysBound = false;
  private refreshScheduled = false;
  private disposed = false;

  constructor(private readonly options: TerminalLinkInteractionOptions) {
    const { target } = options;
    target.addEventListener("pointermove", this.handleMove);
    target.addEventListener("pointerdown", this.handleDown);
    target.addEventListener("pointerup", this.handleUp);
    target.addEventListener("pointerleave", this.handleLeave);
    target.addEventListener("pointercancel", this.handleLeave);
  }

  /** True while a link is highlighted or could be: the surface skips work otherwise. */
  get active(): boolean {
    return this.hit !== null || this.pointer?.modifier === true;
  }

  /** Takes over an event that happened while this was still loading. */
  ingest(event: Event): void {
    switch (event.type) {
      case "pointermove":
        this.handleMove(event as PointerEvent);
        break;
      case "pointerdown":
        this.handleDown(event as PointerEvent);
        break;
      case "pointerup":
        this.handleUp(event as PointerEvent);
        break;
      case "keydown":
      case "keyup":
        this.handleKey(event as KeyboardEvent);
        break;
    }
  }

  /** The cells under the pointer changed meaning (output, scroll): look again. */
  invalidate(): void {
    if (this.disposed || !this.active || this.refreshScheduled) return;
    this.refreshScheduled = true;
    (this.options.schedule ?? defaultSchedule)(() => {
      this.refreshScheduled = false;
      if (this.disposed) return;
      const pressed = this.down;
      this.cellKey = -1;
      this.evaluate(true);
      // Pressing selects, and the selection's damage lands here before the
      // button is released: the press stays armed while it is the same link.
      if (pressed && !(this.hit && sameLink(this.hit, pressed))) {
        this.down = null;
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const { target } = this.options;
    target.removeEventListener("pointermove", this.handleMove);
    target.removeEventListener("pointerdown", this.handleDown);
    target.removeEventListener("pointerup", this.handleUp);
    target.removeEventListener("pointerleave", this.handleLeave);
    target.removeEventListener("pointercancel", this.handleLeave);
    this.unbindKeys();
    this.pointer = null;
    this.down = null;
    this.setHit(null);
  }

  private readonly handleMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch") return;
    this.observe(event);
    this.bindKeys();
    this.evaluate();
  };

  private readonly handleDown = (event: PointerEvent): void => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    this.observe(event);
    this.bindKeys();
    this.down = null;
    if (!this.pointer?.modifier) return;
    this.evaluate();
    this.down = this.hit;
  };

  private readonly handleUp = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const down = this.down;
    this.down = null;
    if (!down) return;
    this.observe(event);
    if (!this.pointer?.modifier) return;
    this.evaluate();
    const hit = this.hit;
    if (!hit || !sameLink(hit, down)) return;
    event.preventDefault();
    this.options.onActivate(hit);
  };

  private readonly handleLeave = (): void => {
    this.down = null;
    this.pointer = null;
    this.unbindKeys();
    this.cellKey = -1;
    this.setHit(null);
  };

  private readonly handleKey = (event: KeyboardEvent): void => {
    const pointer = this.pointer;
    if (!pointer) return;
    const modifier = this.options.isModifier(event);
    if (modifier === pointer.modifier && event.shiftKey === pointer.shift) {
      return;
    }
    pointer.modifier = modifier;
    pointer.shift = event.shiftKey;
    this.cellKey = -1;
    this.evaluate();
  };

  private readonly handleBlur = (): void => {
    if (!this.pointer) return;
    this.pointer.modifier = false;
    this.down = null;
    this.cellKey = -1;
    this.setHit(null);
  };

  private observe(event: PointerEvent): void {
    this.pointer = {
      x: event.clientX,
      y: event.clientY,
      shift: event.shiftKey,
      modifier: this.options.isModifier(event),
      target: event.target,
    };
  }

  private evaluate(force = false): void {
    const pointer = this.pointer;
    if (
      !pointer ||
      !pointer.modifier ||
      this.options.blocked(pointer.shift, pointer.target)
    ) {
      this.cellKey = -1;
      this.setHit(null);
      return;
    }
    const cell = this.options.cellAt(pointer.x, pointer.y);
    if (!cell) {
      this.cellKey = -1;
      this.setHit(null);
      return;
    }
    const key = cell.row * 0x10000 + cell.column;
    if (key === this.cellKey) return;
    this.cellKey = key;
    if (!force && this.hit && hitContains(this.hit, cell)) return;
    this.setHit(this.options.hitAt(cell));
  }

  private setHit(next: TerminalLinkHit | null): void {
    const previous = this.hit;
    if (previous === next) return;
    if (previous && next && sameHit(previous, next)) {
      this.hit = next;
      return;
    }
    this.hit = next;
    if (next) {
      this.options.overlay.show(next);
      if (!previous) this.options.setPointerCursor(true);
    } else {
      this.options.overlay.hide();
      this.options.setPointerCursor(false);
    }
  }

  private bindKeys(): void {
    if (this.keysBound) return;
    this.keysBound = true;
    const keys = this.options.keyTarget;
    keys.addEventListener("keydown", this.handleKey);
    keys.addEventListener("keyup", this.handleKey);
    keys.addEventListener("blur", this.handleBlur);
  }

  private unbindKeys(): void {
    if (!this.keysBound) return;
    this.keysBound = false;
    const keys = this.options.keyTarget;
    keys.removeEventListener("keydown", this.handleKey);
    keys.removeEventListener("keyup", this.handleKey);
    keys.removeEventListener("blur", this.handleBlur);
  }
}

function defaultSchedule(callback: () => void): void {
  requestAnimationFrame(callback);
}

function hitContains(hit: TerminalLinkHit, cell: LinkCell): boolean {
  return hit.segments.some(
    (segment) =>
      segment.row === cell.row &&
      cell.column >= segment.start &&
      cell.column < segment.end,
  );
}

function sameLink(a: TerminalLinkHit, b: TerminalLinkHit): boolean {
  return (
    a.kind === b.kind &&
    a.uri === b.uri &&
    a.segments[0]?.row === b.segments[0]?.row &&
    a.segments[0]?.start === b.segments[0]?.start
  );
}

function sameHit(a: TerminalLinkHit, b: TerminalLinkHit): boolean {
  return (
    sameLink(a, b) &&
    a.segments.length === b.segments.length &&
    a.segments.every((segment, index) => {
      const other = b.segments[index];
      return (
        segment.row === other.row &&
        segment.start === other.start &&
        segment.end === other.end
      );
    })
  );
}
