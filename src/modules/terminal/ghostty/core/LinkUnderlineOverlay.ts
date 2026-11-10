import type { LinkOverlay } from "./TerminalLinkInteraction";
import { linkDestinationLabel } from "./terminalLinkTargets";
import type { TerminalLinkHit } from "./terminalLinks";

export type LinkUnderlineGeometry = {
  readonly cellWidth: number;
  readonly cellHeight: number;
  /** CSS pixels the drawn grid is shifted up while a resize gesture waits. */
  readonly shiftY: number;
  readonly color: string;
};

/**
 * Underline for the highlighted link plus a status chip naming where it leads,
 * so an OSC 8 link cannot hide its destination behind friendly text. Plain
 * absolutely positioned elements, created only while a link is hovered with the
 * modifier held: no frame cost and no compositing layer of their own.
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
    this.showDestination(layer, linkDestinationLabel(hit));
  }

  hide(): void {
    this.layer?.replaceChildren();
  }

  dispose(): void {
    this.layer?.remove();
    this.layer = null;
  }

  private showDestination(layer: HTMLElement, label: string): void {
    if (label === "") return;
    const chip = this.root.ownerDocument.createElement("div");
    chip.textContent = label;
    chip.style.cssText =
      "position:absolute;left:0;top:0;max-width:min(80vw,60rem);overflow:hidden;" +
      "text-overflow:ellipsis;white-space:nowrap;pointer-events:none;" +
      "padding:2px 8px;border:1px solid var(--border,#444);border-left:0;" +
      "border-radius:0 6px 0 0;background:var(--popover,#222);" +
      "color:var(--popover-foreground,#eee);font:12px/1.4 system-ui,sans-serif;";
    // Bottom left of the pane, like a browser status line.
    chip.style.top = `${Math.max(0, this.root.clientHeight - 24)}px`;
    layer.append(chip);
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
