export type AnchorRect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

type AnchorStyle = Pick<
  CSSStyleDeclaration,
  "left" | "top" | "width" | "height" | "lineHeight"
>;

/**
 * The IME candidate window follows the input element, which otherwise rests in
 * the pane's corner. It is moved onto the cursor cell when a composition starts
 * and put back when it ends. The position is read once: a program that keeps
 * repainting while the user composes (Codex, Claude Code) moves the cursor
 * constantly, and a candidate window that follows it jumps under the user's
 * eyes.
 */
export class ImeAnchor {
  private saved: AnchorStyle | null = null;

  constructor(
    private readonly style: AnchorStyle,
    private readonly cursorCell: () => AnchorRect | null,
  ) {}

  begin(): void {
    if (this.saved) return;
    const rect = this.cursorCell();
    if (!rect) return;
    const { style } = this;
    this.saved = {
      left: style.left,
      top: style.top,
      width: style.width,
      height: style.height,
      lineHeight: style.lineHeight,
    };
    style.left = `${rect.left}px`;
    style.top = `${rect.top}px`;
    style.width = `${rect.width}px`;
    style.height = `${rect.height}px`;
    style.lineHeight = `${rect.height}px`;
  }

  end(): void {
    const saved = this.saved;
    if (!saved) return;
    this.saved = null;
    const { style } = this;
    style.left = saved.left;
    style.top = saved.top;
    style.width = saved.width;
    style.height = saved.height;
    style.lineHeight = saved.lineHeight;
  }
}
