import type { GhosttyTerminalModelApi } from "./GhosttyTerminalModel";

type LinkModel = Pick<
  GhosttyTerminalModelApi,
  "cols" | "rows" | "modes" | "hyperlinkAtViewportCell"
>;

export type TerminalLinkSegment = { row: number; start: number; end: number };

export type TerminalLinkHoverOptions = {
  readonly root: HTMLElement;
  readonly model: LinkModel;
  readonly cellSize: () => { readonly width: number; readonly height: number };
  readonly gridShiftY: () => number;
  /** False while the surface has no host: hover is cleared and nothing opens. */
  readonly active: () => boolean;
  readonly ignoreTarget: (target: EventTarget | null) => boolean;
  readonly underlineColor: () => string;
  readonly onOpenLink?: (uri: string) => void;
  readonly isMac?: boolean;
};

type PointerState = {
  clientX: number;
  clientY: number;
  metaKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
};

/**
 * The cells around (row, column) that carry `uri`, following the link across row ends, as one
 * segment per row. Scans at most `maxRows` rows each way.
 */
export function terminalLinkSegments(
  model: LinkModel,
  row: number,
  column: number,
  uri: string,
  maxRows = 8,
): TerminalLinkSegment[] {
  const cols = model.cols;
  const total = cols * model.rows;
  const limit = maxRows * cols;
  const same = (index: number) =>
    model.hyperlinkAtViewportCell(Math.floor(index / cols), index % cols) ===
    uri;
  const origin = row * cols + column;
  let first = origin;
  while (first > 0 && origin - first < limit && same(first - 1)) first--;
  let last = origin;
  while (last + 1 < total && last - origin < limit && same(last + 1)) last++;
  const segments: TerminalLinkSegment[] = [];
  const firstRow = Math.floor(first / cols);
  const lastRow = Math.floor(last / cols);
  for (let y = firstRow; y <= lastRow; y++) {
    segments.push({
      row: y,
      start: y === firstRow ? first % cols : 0,
      end: y === lastRow ? last % cols : cols - 1,
    });
  }
  return segments;
}

/**
 * Hover, underline and click handling for terminal links, shared by the WebGPU and WebGL
 * surfaces. While the application tracks the mouse (Claude Code, vim) links answer only to
 * Shift, or Cmd on macOS; otherwise a plain hover and click work.
 */
export class TerminalLinkHover {
  private hoveredCell = -1;
  private hoveredLink: string | null = null;
  private mouseDownLink: string | null = null;
  private pointer: PointerState | null = null;
  private segments: TerminalLinkSegment[] = [];
  private readonly underlines: HTMLElement[] = [];
  private readonly isMac: boolean;
  private readonly keyTarget: Window | null;

  constructor(private readonly options: TerminalLinkHoverOptions) {
    this.isMac = options.isMac ?? /Mac|iPhone|iPad/.test(navigator.userAgent);
    this.keyTarget = options.root.ownerDocument?.defaultView ?? null;
    options.root.addEventListener("mousemove", this.handleMouseMove);
    options.root.addEventListener("mousedown", this.handleMouseDown);
    options.root.addEventListener("mouseup", this.handleMouseUp);
    options.root.addEventListener("mouseleave", this.handleMouseLeave);
    this.keyTarget?.addEventListener("keydown", this.handleModifier);
    this.keyTarget?.addEventListener("keyup", this.handleModifier);
  }

  /**
   * The grid changed under a still pointer (agents redraw constantly): re-read the link there
   * instead of dropping it, so a click that spans a redraw still opens.
   */
  refresh(): void {
    if (this.hoveredCell < 0) return;
    this.hoveredCell = -1;
    if (this.pointer) this.update(this.pointer);
    else this.clear();
    if (this.hoveredLink !== this.mouseDownLink) this.mouseDownLink = null;
  }

  clear(): void {
    this.hoveredCell = -1;
    this.hoveredLink = null;
    this.segments = [];
    this.options.root.style.cursor = "text";
    for (const line of this.underlines) line.style.display = "none";
  }

  dispose(): void {
    const { root } = this.options;
    root.removeEventListener("mousemove", this.handleMouseMove);
    root.removeEventListener("mousedown", this.handleMouseDown);
    root.removeEventListener("mouseup", this.handleMouseUp);
    root.removeEventListener("mouseleave", this.handleMouseLeave);
    this.keyTarget?.removeEventListener("keydown", this.handleModifier);
    this.keyTarget?.removeEventListener("keyup", this.handleModifier);
    for (const line of this.underlines) line.remove();
    this.underlines.length = 0;
  }

  private readonly handleMouseMove = (event: MouseEvent): void => {
    this.pointer = pointerState(event);
    this.update(this.pointer);
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    this.pointer = pointerState(event);
    this.update(this.pointer);
    this.mouseDownLink = this.hoveredLink;
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    this.pointer = pointerState(event);
    this.update(this.pointer);
    const uri = this.hoveredLink;
    const activate = uri !== null && uri === this.mouseDownLink;
    this.mouseDownLink = null;
    if (!activate || !this.options.active()) return;
    event.preventDefault();
    this.options.onOpenLink?.(uri);
  };

  private readonly handleMouseLeave = (): void => {
    this.pointer = null;
    this.mouseDownLink = null;
    this.clear();
  };

  // Pressing or releasing Cmd/Shift over a link toggles it without moving the mouse.
  private readonly handleModifier = (event: KeyboardEvent): void => {
    if (!this.pointer || (event.key !== "Meta" && event.key !== "Shift")) {
      return;
    }
    this.pointer = {
      ...this.pointer,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    };
    this.hoveredCell = -1;
    this.update(this.pointer);
  };

  private update(pointer: PointerState): void {
    const { model, root } = this.options;
    const bypass = pointer.shiftKey || (this.isMac && pointer.metaKey);
    if (
      !this.options.active() ||
      this.options.ignoreTarget(pointer.target) ||
      (model.modes().mouseTracking && !bypass)
    ) {
      this.clear();
      return;
    }
    const cell = this.options.cellSize();
    if (cell.width <= 0 || cell.height <= 0) {
      this.clear();
      return;
    }
    const rect = root.getBoundingClientRect();
    const column = Math.floor((pointer.clientX - rect.left) / cell.width);
    const row = Math.floor(
      (pointer.clientY - rect.top + this.options.gridShiftY()) / cell.height,
    );
    if (column < 0 || column >= model.cols || row < 0 || row >= model.rows) {
      this.clear();
      return;
    }
    const index = row * model.cols + column;
    if (index === this.hoveredCell) return;
    this.hoveredCell = index;
    const previous = this.hoveredLink;
    this.hoveredLink = model.hyperlinkAtViewportCell(row, column);
    root.style.cursor = this.hoveredLink ? "pointer" : "text";
    const inside = this.segments.some(
      (segment) =>
        segment.row === row && column >= segment.start && column <= segment.end,
    );
    if (this.hoveredLink !== previous || !inside)
      this.drawUnderline(row, column);
  }

  private drawUnderline(row: number, column: number): void {
    const uri = this.hoveredLink;
    this.segments = uri
      ? terminalLinkSegments(this.options.model, row, column, uri)
      : [];
    const cell = this.options.cellSize();
    const shift = this.options.gridShiftY();
    const thickness = Math.max(1, Math.round(cell.height / 16));
    const inset = Math.max(2, Math.round(cell.height * 0.12));
    const color = this.segments.length ? this.options.underlineColor() : "";
    this.segments.forEach((segment, index) => {
      let line = this.underlines[index];
      if (!line) {
        line = document.createElement("div");
        line.style.cssText =
          "position:absolute;pointer-events:none;z-index:5;display:none;";
        this.options.root.append(line);
        this.underlines.push(line);
      }
      line.style.left = `${segment.start * cell.width}px`;
      line.style.width = `${(segment.end - segment.start + 1) * cell.width}px`;
      line.style.top = `${(segment.row + 1) * cell.height - shift - inset}px`;
      line.style.height = `${thickness}px`;
      line.style.backgroundColor = color;
      line.style.display = "block";
    });
    for (
      let index = this.segments.length;
      index < this.underlines.length;
      index++
    ) {
      this.underlines[index].style.display = "none";
    }
  }
}

function pointerState(event: MouseEvent): PointerState {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    target: event.target,
  };
}
