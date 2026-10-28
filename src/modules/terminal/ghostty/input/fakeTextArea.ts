/** Node-side stand-ins for the terminal input proxy (no DOM in unit tests). */
export class FakeElement extends EventTarget {
  getBoundingClientRect(): DOMRect {
    return {
      left: 0,
      top: 0,
      right: 800,
      bottom: 480,
      width: 800,
      height: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  }
}

/**
 * Value and selection behave like a textarea: assigning `value` moves the
 * caret to the end (collapsed), `setSelectionRange`/`select` change the range.
 */
export class FakeTextArea extends FakeElement {
  style = { cssText: "" } as CSSStyleDeclaration;
  selectionStart = 0;
  selectionEnd = 0;
  focus = (): void => {};
  private text = "";

  get value(): string {
    return this.text;
  }

  set value(next: string) {
    if (next === this.text) return;
    this.text = next;
    this.selectionStart = this.selectionEnd = next.length;
  }

  setSelectionRange(start: number, end: number): void {
    this.selectionStart = Math.min(start, this.text.length);
    this.selectionEnd = Math.min(end, this.text.length);
  }

  select(): void {
    this.setSelectionRange(0, this.text.length);
  }

  /** WebKit's default action for typing/IME: replace the selection with `data`. */
  replaceSelection(data: string): void {
    const before = this.text.slice(0, this.selectionStart);
    const after = this.text.slice(this.selectionEnd);
    this.text = before + data + after;
    this.selectionStart = this.selectionEnd = before.length + data.length;
  }

  get caretVisible(): boolean {
    return this.selectionStart === this.selectionEnd;
  }
}
