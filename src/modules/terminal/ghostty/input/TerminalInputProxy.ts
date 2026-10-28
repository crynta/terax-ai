/**
 * The terminal's hidden `<textarea>` is an input proxy, never a text store. A
 * focused editable with a collapsed selection keeps WebKit's text-caret
 * animation (a display link at display rate, ~3 % CPU and ~250 wakeups/s for an
 * idle window) running even when the caret is invisible. A non-collapsed
 * selection paints no caret, so the proxy always holds one placeholder
 * character, selected.
 *
 * Rules: keep (value, selection) at (placeholder, 0..1) whenever nothing else
 * owns the field, and never touch either while an IME composition is in
 * progress or while the native context menu is given real text to copy.
 *
 * This is a WebKit/macOS fix and macOS only: on WebKitGTK or Chromium a
 * non-collapsed selection in a focused textarea can take over the X11 PRIMARY
 * selection and is announced by screen readers. Elsewhere (`placeholder:
 * false`) the field stays empty with a collapsed selection, as before.
 */
export const TERMINAL_INPUT_PLACEHOLDER = " ";

type ProxyInput = Pick<
  HTMLTextAreaElement,
  | "value"
  | "selectionStart"
  | "selectionEnd"
  | "setSelectionRange"
  | "addEventListener"
  | "removeEventListener"
>;

export type TerminalInputProxyOptions = {
  /** Keep the selected placeholder (macOS). Otherwise the field is kept empty. */
  readonly placeholder: boolean;
};

export class TerminalInputProxy {
  private composing = false;
  private exposed = false;
  private readonly placeholder: boolean;

  constructor(
    private readonly input: ProxyInput,
    options: TerminalInputProxyOptions = { placeholder: true },
  ) {
    this.placeholder = options.placeholder;
    input.addEventListener("compositionstart", this.compositionStart);
    input.addEventListener("compositionend", this.compositionEnd);
    input.addEventListener("input", this.settle);
    input.addEventListener("keyup", this.settle);
    input.addEventListener("focus", this.settle);
    input.addEventListener("blur", this.blur);
    this.arm();
  }

  dispose(): void {
    const { input } = this;
    input.removeEventListener("compositionstart", this.compositionStart);
    input.removeEventListener("compositionend", this.compositionEnd);
    input.removeEventListener("input", this.settle);
    input.removeEventListener("keyup", this.settle);
    input.removeEventListener("focus", this.settle);
    input.removeEventListener("blur", this.blur);
  }

  /** Restores the placeholder and its selection unless the field is in use. */
  arm(): void {
    if (this.composing || this.exposed) return;
    const { input } = this;
    if (!this.placeholder) {
      if (input.value !== "") input.value = "";
      return;
    }
    if (input.value !== TERMINAL_INPUT_PLACEHOLDER)
      input.value = TERMINAL_INPUT_PLACEHOLDER;
    if (input.selectionStart !== 0 || input.selectionEnd !== 1)
      input.setSelectionRange(0, 1);
  }

  /**
   * Gives the native context menu real text to copy; empty text keeps the
   * placeholder. The caller selects and focuses the field afterwards.
   */
  expose(text: string): void {
    if (this.composing) return;
    if (!text) {
      this.exposed = false;
      this.arm();
      return;
    }
    this.exposed = true;
    this.input.value = text;
  }

  /** Ends {@link expose} and restores the placeholder. */
  release(): void {
    this.exposed = false;
    this.arm();
  }

  private readonly compositionStart = (): void => {
    this.composing = true;
  };

  private readonly compositionEnd = (): void => {
    this.composing = false;
    this.arm();
  };

  private readonly settle = (event: Event): void => {
    if (this.composing || (event as InputEvent).isComposing) return;
    this.arm();
  };

  private readonly blur = (): void => {
    this.composing = false;
  };
}
