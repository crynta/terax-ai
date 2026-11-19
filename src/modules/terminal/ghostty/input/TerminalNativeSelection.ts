import type { TerminalInputProxy } from "./TerminalInputProxy";

type Options = {
  readonly proxy: Pick<TerminalInputProxy, "expose" | "release">;
  readonly input: HTMLTextAreaElement;
  readonly target: HTMLElement;
  readonly getSelection: () => string | null;
  readonly mouseTracking: () => boolean;
  readonly isMac: boolean;
};

/** Exposes a canvas selection to the webview's native text menu on demand. */
export class TerminalNativeSelection {
  private originalStyle: string | null = null;

  constructor(private readonly options: Options) {
    for (const [target, type, listener, capture] of this.listeners())
      target.addEventListener(type, listener, capture);
  }

  readonly reset = (): void => {
    if (this.originalStyle === null) return;
    this.options.input.style.cssText = this.originalStyle;
    this.originalStyle = null;
    this.options.proxy.release();
  };

  dispose(): void {
    this.reset();
    for (const [target, type, listener, capture] of this.listeners())
      target.removeEventListener(type, listener, capture);
  }

  private listeners(): [EventTarget, string, EventListener, boolean][] {
    const { target, input } = this.options;
    return [
      [target, "pointerdown", this.pointerDown as EventListener, true],
      [target, "contextmenu", this.contextMenu as EventListener, false],
      [input, "copy", this.copy as EventListener, false],
      [input, "cut", this.copy as EventListener, false],
      [input, "blur", this.reset, false],
    ];
  }

  private readonly pointerDown = (event: PointerEvent): void => {
    this.reset();
    if (
      (event.button !== 2 &&
        !(this.options.isMac && event.button === 0 && event.ctrlKey)) ||
      (this.options.mouseTracking() && !event.shiftKey)
    )
      return;
    // Preserve the grid selection and make the later native hit test editable.
    event.stopPropagation();
    this.prepare(event);
  };

  private readonly contextMenu = (event: MouseEvent): void => {
    if (this.options.mouseTracking() && !event.shiftKey) {
      event.preventDefault();
      return;
    }
    this.prepare(event);
  };

  private prepare(event: MouseEvent): void {
    const { target, input } = this.options;
    const rect = target.getBoundingClientRect();
    this.originalStyle ??= input.style.cssText;
    Object.assign(input.style, {
      left: `${Math.max(0, event.clientX - rect.left - 10)}px`,
      top: `${Math.max(0, event.clientY - rect.top - 10)}px`,
      width: "20px",
      height: "20px",
      zIndex: "20",
      pointerEvents: "auto",
      userSelect: "text",
    });
    this.options.proxy.expose(this.options.getSelection() ?? "");
    input.focus({ preventScroll: true });
    input.select();
  }

  private readonly copy = (event: ClipboardEvent): void => {
    // The proxy's placeholder is selected whenever there is no terminal text:
    // native Copy/Cut must not put it on the clipboard.
    event.preventDefault();
    const text = this.options.getSelection();
    if (!text || !event.clipboardData) return;
    event.clipboardData.setData("text/plain", text);
  };
}
