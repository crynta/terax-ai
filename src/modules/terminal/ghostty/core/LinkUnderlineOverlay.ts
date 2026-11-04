import type { LinkOverlay } from "./TerminalLinkInteraction";
import type { TerminalLinkHit } from "./terminalLinks";

export type LinkUnderlineGeometry = {
  readonly cellWidth: number;
  readonly cellHeight: number;
  /** CSS pixels the drawn grid is shifted up while a resize gesture waits. */
  readonly shiftY: number;
  readonly color: string;
};

/**
 * Underline for the highlighted link: plain absolutely positioned bars, one per
 * row segment, created only while a link is hovered with the modifier held. No
 * frame cost and no compositing layer of their own.
 */
export class LinkUnderlineOverlay implements LinkOverlay {
  private layer: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly geometry: () => LinkUnderlineGeometry,
  ) {}

  show(hit: TerminalLinkHit): void {
    const layer = this.layer ?? this.createLayer();
    const { cellWidth, cellHeight, shiftY, color } = this.geometry();
    const bars = hit.segments.map((segment) => {
      const bar = this.root.ownerDocument.createElement("div");
      bar.style.cssText =
        `position:absolute;height:1px;background:${color};pointer-events:none;` +
        `left:${segment.start * cellWidth}px;` +
        `top:${(segment.row + 1) * cellHeight - shiftY - 2}px;` +
        `width:${(segment.end - segment.start) * cellWidth}px;`;
      return bar;
    });
    layer.replaceChildren(...bars);
  }

  hide(): void {
    this.layer?.replaceChildren();
  }

  dispose(): void {
    this.layer?.remove();
    this.layer = null;
  }

  private createLayer(): HTMLElement {
    const layer = this.root.ownerDocument.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText =
      "position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:5;";
    this.root.append(layer);
    this.layer = layer;
    return layer;
  }
}
