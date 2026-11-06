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
  readonly send: (report: Uint8Array) => void;
};

const encoder = new TextEncoder();

/**
 * Mouse reports for programs that track the mouse (DEC 1000 to 1006). Nothing
 * here runs until a program asks for the mouse, so it loads apart from the
 * keyboard path.
 */
export class TerminalMouse {
  private buttons = 0;
  private lastMotion: string | null = null;
  private lastPress: MouseEvent | null = null;
  private readonly documentRelease = (event: MouseEvent): void =>
    this.button(event, true);

  private readonly listeners: [string, (event: MouseEvent) => void][] = [
    ["mousedown", (event) => this.button(event, false)],
    ["mouseup", (event) => this.button(event, true)],
    ["mousemove", (event) => this.move(event)],
  ];

  constructor(private readonly host: MouseHost) {
    for (const [type, listener] of this.listeners)
      host.pointerTarget.addEventListener(type, listener as EventListener);
    host.pointerTarget.ownerDocument.defaultView?.addEventListener(
      "blur",
      this.releaseButtons,
    );
  }

  dispose(): void {
    this.clearButtons();
    this.host.pointerTarget.ownerDocument.defaultView?.removeEventListener(
      "blur",
      this.releaseButtons,
    );
    for (const [type, listener] of this.listeners)
      this.host.pointerTarget.removeEventListener(
        type,
        listener as EventListener,
      );
  }

  button(event: MouseEvent, release: boolean): void {
    if (event.button < 0 || event.button > 2) return;
    const bit = 1 << event.button;
    if (release) {
      if ((this.buttons & bit) === 0) return;
      this.buttons &= ~bit;
      if (this.buttons === 0) this.clearButtons();
    } else if (event.shiftKey) return;
    if (!this.host.model.modes().mouseTracking) {
      this.clearButtons();
      return;
    }
    const position = this.position(event);
    if (!position) return;
    if (!release) {
      this.buttons |= bit;
      this.lastPress = event;
      this.host.pointerTarget.ownerDocument.addEventListener(
        "mouseup",
        this.documentRelease as EventListener,
        true,
      );
    }
    this.lastMotion = null;
    consume(event);
    this.send(event.button, position, release, event);
  }

  readonly releaseButtons = (): void => {
    const event = this.lastPress;
    const position = event && this.position(event);
    if (event && position && this.host.model.modes().mouseTracking)
      for (let button = 0; button < 3; button++)
        if ((this.buttons & (1 << button)) !== 0)
          this.send(button, position, true, event);
    this.clearButtons();
  };

  private clearButtons(): void {
    this.buttons = 0;
    this.lastPress = null;
    this.lastMotion = null;
    this.host.pointerTarget.ownerDocument.removeEventListener(
      "mouseup",
      this.documentRelease as EventListener,
      true,
    );
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
            : 3);
    if (this.buttons !== 0) this.lastPress = event;
    const signature = [
      button,
      position.col,
      position.row,
      terminalMouseModifiers(event),
      buttonMotion ? 1 : 0,
      anyMotion ? 1 : 0,
      model.mode(1006) ? 1 : 0,
      model.mode(1005) ? 1 : 0,
    ].join(":");
    consume(event);
    if (signature === this.lastMotion) return;
    this.lastMotion = signature;
    this.send(button, position, false, event);
  }

  /** `times` wheel notches up or down at the pointer. */
  wheel(event: MouseEvent, up: boolean, times: number): void {
    const position = this.position(event);
    if (!position || times <= 0) return;
    const report = this.report(up ? 64 : 65, position, false, event);
    const reports = new Uint8Array(report.length * times);
    for (let index = 0; index < times; index++)
      reports.set(report, index * report.length);
    this.host.send(reports);
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
  ): Uint8Array {
    const encodedButton = button + terminalMouseModifiers(event);
    if (this.host.model.mode(1006))
      return encoder.encode(
        `\x1b[<${encodedButton};${col};${row}${release ? "m" : "M"}`,
      );
    const legacyButton = release
      ? 3 + terminalMouseModifiers(event)
      : encodedButton;
    const utf8 = this.host.model.mode(1005);
    const limit = utf8 ? 2047 : 255;
    const bytes = [
      27,
      91,
      77,
      legacyButton + 32,
      Math.min(limit, col + 32),
      Math.min(limit, row + 32),
    ];
    return utf8
      ? encoder.encode(String.fromCharCode(...bytes))
      : Uint8Array.from(bytes);
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
