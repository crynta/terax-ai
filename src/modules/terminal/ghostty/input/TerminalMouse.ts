import type { GhosttyTerminalModelApi } from "../GhosttyTerminalModel";

export type MouseHost = {
  readonly model: Pick<
    GhosttyTerminalModelApi,
    "cols" | "rows" | "mode" | "modes"
  >;
  readonly pointerTarget: HTMLElement;
  readonly cellSize: () => { width: number; height: number };
  /** CSS pixels the drawn grid is moved up inside the pointer target; zero when absent. */
  readonly gridShiftY?: () => number;
  readonly send: (report: string) => void;
};

/**
 * Mouse reports for programs that track the mouse (DEC 1000 to 1006). Nothing
 * here runs until a program asks for the mouse, so it loads apart from the
 * keyboard path.
 */
export class TerminalMouse {
  private buttons = 0;
  private lastMotion: string | null = null;

  private readonly listeners: [string, (event: MouseEvent) => void][] = [
    ["mousedown", (event) => this.button(event, false)],
    ["mouseup", (event) => this.button(event, true)],
    ["mousemove", (event) => this.move(event)],
  ];

  constructor(private readonly host: MouseHost) {
    for (const [type, listener] of this.listeners)
      host.pointerTarget.addEventListener(type, listener as EventListener);
  }

  dispose(): void {
    for (const [type, listener] of this.listeners)
      this.host.pointerTarget.removeEventListener(
        type,
        listener as EventListener,
      );
  }

  button(event: MouseEvent, release: boolean): void {
    if (!this.host.model.modes().mouseTracking || event.shiftKey) return;
    const position = this.position(event);
    if (!position) return;
    const bit = 1 << event.button;
    this.buttons = release ? this.buttons & ~bit : this.buttons | bit;
    this.lastMotion = null;
    consume(event);
    this.send(event.button, position, release, event);
  }

  move(event: MouseEvent): void {
    const { model } = this.host;
    const buttonMotion = model.mode(1002);
    const anyMotion = model.mode(1003);
    if (
      event.shiftKey ||
      (!anyMotion && (!buttonMotion || this.buttons === 0))
    ) {
      this.lastMotion = null;
      return;
    }
    const position = this.position(event);
    if (!position) return;
    const button =
      32 +
      ((this.buttons & 1) !== 0
        ? 0
        : (this.buttons & 2) !== 0
          ? 1
          : (this.buttons & 4) !== 0
            ? 2
            : 0);
    const signature = [
      button,
      position.col,
      position.row,
      terminalMouseModifiers(event),
      buttonMotion ? 1 : 0,
      anyMotion ? 1 : 0,
      model.mode(1006) ? 1 : 0,
    ].join(":");
    consume(event);
    if (signature === this.lastMotion) return;
    this.lastMotion = signature;
    this.send(button, position, false, event);
  }

  /** `times` wheel notches up or down at the pointer. */
  wheel(event: MouseEvent, up: boolean, times: number): void {
    const position = this.position(event);
    if (position)
      this.host.send(
        this.report(up ? 64 : 65, position, false, event).repeat(times),
      );
  }

  private position(event: MouseEvent): { col: number; row: number } | null {
    const { model, pointerTarget, cellSize, gridShiftY } = this.host;
    const rect = pointerTarget.getBoundingClientRect();
    const cell = cellSize();
    if (cell.width <= 0 || cell.height <= 0) return null;
    return {
      col: Math.max(
        1,
        Math.min(
          model.cols,
          Math.floor((event.clientX - rect.left) / cell.width) + 1,
        ),
      ),
      row: Math.max(
        1,
        Math.min(
          model.rows,
          Math.floor(
            (event.clientY - rect.top + (gridShiftY?.() ?? 0)) / cell.height,
          ) + 1,
        ),
      ),
    };
  }

  private report(
    button: number,
    { col, row }: { col: number; row: number },
    release: boolean,
    event: MouseEvent,
  ): string {
    const encodedButton = button + terminalMouseModifiers(event);
    if (this.host.model.mode(1006))
      return `\x1b[<${encodedButton};${col};${row}${release ? "m" : "M"}`;
    const legacyButton = release ? 3 : encodedButton;
    return `\x1b[M${String.fromCharCode(legacyButton + 32)}${String.fromCharCode(
      Math.min(255, col + 32),
    )}${String.fromCharCode(Math.min(255, row + 32))}`;
  }

  private send(
    button: number,
    position: { col: number; row: number },
    release: boolean,
    event: MouseEvent,
  ): void {
    this.host.send(this.report(button, position, release, event));
  }
}

export function terminalMouseModifiers(
  event: Pick<MouseEvent, "altKey" | "ctrlKey" | "shiftKey">,
): number {
  let modifiers = 0;
  if (event.shiftKey) modifiers |= 4;
  if (event.altKey) modifiers |= 8;
  if (event.ctrlKey) modifiers |= 16;
  return modifiers;
}

function consume(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}
