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
    options.target.addEventListener("pointerdown", this.pointerDown, true);
    options.target.addEventListener("contextmenu", this.contextMenu);
    options.input.addEventListener("copy", this.copy);
    options.input.addEventListener("cut", this.copy);
    options.input.addEventListener("blur", this.reset);
  }

  readonly reset = (): void => {
    if (this.originalStyle === null) return;
    this.options.input.style.cssText = this.originalStyle;
    this.originalStyle = null;
    this.options.proxy.release();
  };

  dispose(): void {
    this.reset();
    const { target, input } = this.options;
    target.removeEventListener("pointerdown", this.pointerDown, true);
    target.removeEventListener("contextmenu", this.contextMenu);
    input.removeEventListener("copy", this.copy);
    input.removeEventListener("cut", this.copy);
    input.removeEventListener("blur", this.reset);
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
    input.style.left = `${Math.max(0, event.clientX - rect.left - 10)}px`;
    input.style.top = `${Math.max(0, event.clientY - rect.top - 10)}px`;
    input.style.width = "20px";
    input.style.height = "20px";
    input.style.zIndex = "20";
    input.style.pointerEvents = "auto";
    input.style.userSelect = "text";
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
