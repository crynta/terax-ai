import type {
  GhosttyTerminalModelApi,
  TerminalBufferPoint,
  TerminalBufferSelection,
} from "../GhosttyTerminalModel";

type SelectionMode = "character" | "word" | "line";

export type TerminalSelectionControllerOptions = {
  readonly model: GhosttyTerminalModelApi;
  readonly target: HTMLElement;
  readonly cellSize: () => { readonly width: number; readonly height: number };
  readonly shouldIgnoreTarget: (target: EventTarget | null) => boolean;
  readonly onChange: () => void;
};

export class TerminalSelectionController {
  private selection: TerminalBufferSelection | null = null;
  private anchorRange: { readonly start: number; readonly end: number } | null =
    null;
  private mode: SelectionMode = "character";
  private pointerId: number | null = null;
  private meaningful = false;
  private lastClientX = 0;
  private lastClientY = 0;
  private autoScrollFrame: number | null = null;
  private disposed = false;

  constructor(private readonly options: TerminalSelectionControllerOptions) {
    options.target.addEventListener("pointerdown", this.handlePointerDown);
    options.target.addEventListener("pointermove", this.handlePointerMove);
    options.target.addEventListener("pointerup", this.handlePointerUp);
    options.target.addEventListener("pointercancel", this.handlePointerUp);
  }

  get value(): TerminalBufferSelection | null {
    return this.meaningful ? this.selection : null;
  }

  text(): string | null {
    const selection = this.value;
    if (!selection) return null;
    const value = this.options.model.selectionText(selection);
    return value === "" ? null : value;
  }

  contains(line: number, column: number): boolean {
    const selection = this.value;
    if (!selection) return false;
    return selectionContains(selection, { line, column });
  }

  reconcile(): boolean {
    const tracked = this.options.model.trackedSelection?.();
    if (tracked === undefined || selectionsEqual(this.selection, tracked)) {
      return false;
    }
    this.selection = tracked;
    if (!tracked) {
      this.anchorRange = null;
      this.meaningful = false;
      this.stopAutoScroll();
    }
    this.options.onChange();
    return true;
  }

  clear(): boolean {
    if (!this.selection && !this.meaningful) return false;
    this.selection = null;
    this.anchorRange = null;
    this.meaningful = false;
    this.stopAutoScroll();
    this.options.model.setSelection?.(null);
    this.options.onChange();
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAutoScroll();
    const { target } = this.options;
    target.removeEventListener("pointerdown", this.handlePointerDown);
    target.removeEventListener("pointermove", this.handlePointerMove);
    target.removeEventListener("pointerup", this.handlePointerUp);
    target.removeEventListener("pointercancel", this.handlePointerUp);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (
      !shouldStartTerminalSelection(
        event,
        this.options.shouldIgnoreTarget,
        this.options.model.modes().mouseTracking,
      )
    ) {
      return;
    }

    const point = this.pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    this.pointerId = event.pointerId;
    this.options.target.setPointerCapture(event.pointerId);
    this.lastClientX = event.clientX;
    this.lastClientY = event.clientY;

    const existingAnchor = event.shiftKey ? this.selection?.anchor : undefined;
    this.mode =
      event.detail >= 3 ? "line" : event.detail === 2 ? "word" : "character";
    const anchor = existingAnchor ?? point;
    this.anchorRange = this.rangeForPoint(anchor, this.mode);
    const focusRange = this.rangeForPoint(point, this.mode);
    this.selection = selectionForRanges(
      anchor,
      point,
      this.anchorRange,
      focusRange,
      event.altKey,
    );
    this.meaningful = event.shiftKey || this.mode !== "character";
    this.commitSelection();
    this.options.onChange();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId || !this.selection) return;
    event.preventDefault();
    this.lastClientX = event.clientX;
    this.lastClientY = event.clientY;
    this.updateFocus(event);
    this.updateAutoScroll();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    if (this.meaningful || this.mode !== "character") {
      this.updateFocus(event);
    } else {
      this.selection = null;
      this.anchorRange = null;
      this.options.model.setSelection?.(null);
      this.options.onChange();
    }
    if (this.options.target.hasPointerCapture(event.pointerId)) {
      this.options.target.releasePointerCapture(event.pointerId);
    }
    this.pointerId = null;
    this.stopAutoScroll();
  };

  private updateFocus(
    event: Pick<PointerEvent, "clientX" | "clientY" | "altKey">,
  ): void {
    const point = this.pointFromClient(event.clientX, event.clientY, true);
    if (!point || !this.selection || !this.anchorRange) return;
    const focusRange = this.rangeForPoint(point, this.mode);
    this.selection = selectionForRanges(
      this.selection.anchor,
      point,
      this.anchorRange,
      focusRange,
      this.selection.rectangular || event.altKey,
    );
    this.meaningful = true;
    this.commitSelection();
    this.options.onChange();
  }

  private rangeForPoint(
    point: TerminalBufferPoint,
    mode: SelectionMode,
  ): { readonly start: number; readonly end: number } {
    if (mode === "word") return this.options.model.wordRangeAt(point);
    if (mode === "line") {
      return {
        start: 0,
        end: this.options.model.lineEndColumn(point.line),
      };
    }
    return { start: point.column, end: point.column };
  }

  private pointFromEvent(event: PointerEvent): TerminalBufferPoint | null {
    return this.pointFromClient(event.clientX, event.clientY, false);
  }

  private pointFromClient(
    clientX: number,
    clientY: number,
    clamp: boolean,
  ): TerminalBufferPoint | null {
    const rect = this.options.target.getBoundingClientRect();
    const cell = this.options.cellSize();
    if (cell.width <= 0 || cell.height <= 0) return null;
    if (
      !clamp &&
      (clientX < rect.left ||
        clientX >= rect.right ||
        clientY < rect.top ||
        clientY >= rect.bottom)
    ) {
      return null;
    }
    const column = clampInteger(
      Math.floor((clientX - rect.left) / cell.width),
      0,
      this.options.model.cols - 1,
    );
    const row = clampInteger(
      Math.floor((clientY - rect.top) / cell.height),
      0,
      this.options.model.rows - 1,
    );
    return {
      line: this.options.model.bufferLineAtViewportRow(row),
      column,
    };
  }

  private updateAutoScroll(): void {
    const rect = this.options.target.getBoundingClientRect();
    if (this.lastClientY >= rect.top && this.lastClientY <= rect.bottom) {
      this.stopAutoScroll();
      return;
    }
    if (this.autoScrollFrame !== null) return;
    const tick = () => {
      this.autoScrollFrame = null;
      if (this.pointerId === null) return;
      const currentRect = this.options.target.getBoundingClientRect();
      const overflow =
        this.lastClientY < currentRect.top
          ? this.lastClientY - currentRect.top
          : this.lastClientY - currentRect.bottom;
      const cellHeight = Math.max(1, this.options.cellSize().height);
      const lines =
        Math.sign(overflow) *
        Math.max(1, Math.min(8, Math.ceil(Math.abs(overflow) / cellHeight)));
      this.options.model.scrollBy(lines);
      this.updateFocus({
        clientX: this.lastClientX,
        clientY: this.lastClientY,
        altKey: this.selection?.rectangular ?? false,
      });
      this.autoScrollFrame = requestAnimationFrame(tick);
    };
    this.autoScrollFrame = requestAnimationFrame(tick);
  }

  private stopAutoScroll(): void {
    if (this.autoScrollFrame !== null)
      cancelAnimationFrame(this.autoScrollFrame);
    this.autoScrollFrame = null;
  }

  private commitSelection(): void {
    this.options.model.setSelection?.(this.meaningful ? this.selection : null);
  }
}

export function shouldStartTerminalSelection(
  event: Pick<
    PointerEvent,
    "button" | "defaultPrevented" | "shiftKey" | "target"
  >,
  shouldIgnoreTarget: (target: EventTarget | null) => boolean,
  mouseTracking: boolean,
): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !shouldIgnoreTarget(event.target) &&
    (!mouseTracking || event.shiftKey)
  );
}

export function selectionContains(
  selection: TerminalBufferSelection,
  point: TerminalBufferPoint,
): boolean {
  const { start, end, left, right } = normalizeSelection(selection);
  if (selection.rectangular) {
    return (
      point.line >= start.line &&
      point.line <= end.line &&
      point.column >= left &&
      point.column <= right
    );
  }
  if (point.line < start.line || point.line > end.line) return false;
  if (start.line === end.line)
    return point.column >= start.column && point.column <= end.column;
  if (point.line === start.line) return point.column >= start.column;
  if (point.line === end.line) return point.column <= end.column;
  return true;
}

export function normalizeSelection(selection: TerminalBufferSelection): {
  readonly start: TerminalBufferPoint;
  readonly end: TerminalBufferPoint;
  readonly left: number;
  readonly right: number;
} {
  const anchorBeforeFocus =
    comparePoints(selection.anchor, selection.focus) <= 0;
  return {
    start: anchorBeforeFocus ? selection.anchor : selection.focus,
    end: anchorBeforeFocus ? selection.focus : selection.anchor,
    left: Math.min(selection.anchor.column, selection.focus.column),
    right: Math.max(selection.anchor.column, selection.focus.column),
  };
}

function selectionForRanges(
  anchor: TerminalBufferPoint,
  focus: TerminalBufferPoint,
  anchorRange: { readonly start: number; readonly end: number },
  focusRange: { readonly start: number; readonly end: number },
  rectangular: boolean,
): TerminalBufferSelection {
  const forward = comparePoints(anchor, focus) <= 0;
  return {
    anchor: {
      line: anchor.line,
      column: forward ? anchorRange.start : anchorRange.end,
    },
    focus: {
      line: focus.line,
      column: forward ? focusRange.end : focusRange.start,
    },
    rectangular,
  };
}

function comparePoints(
  left: TerminalBufferPoint,
  right: TerminalBufferPoint,
): number {
  return left.line === right.line
    ? left.column - right.column
    : left.line - right.line;
}

function selectionsEqual(
  left: TerminalBufferSelection | null,
  right: TerminalBufferSelection | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.rectangular === right.rectangular &&
    left.anchor.line === right.anchor.line &&
    left.anchor.column === right.anchor.column &&
    left.focus.line === right.focus.line &&
    left.focus.column === right.focus.column
  );
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
