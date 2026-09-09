import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";

export class TerminalScrollbarSync {
  private history = -1;
  private offset = -1;
  private cellHeight = 0;
  private viewportHeight = 0;
  private available = false;
  private position: number | null = null;

  invalidate(): void {
    this.history = -1;
  }

  sync(
    viewportHeight: number,
    scrollbar: HTMLElement,
    content: HTMLElement,
    model: GhosttyTerminalModelApi,
    cellHeight: number,
  ): number | null {
    const { history, offset } = model.scrollPosition();
    const available = history > 0 && !model.modes().alternateScreen;
    if (
      history === this.history &&
      offset === this.offset &&
      available === this.available &&
      cellHeight === this.cellHeight &&
      viewportHeight === this.viewportHeight
    )
      return this.position;
    this.history = history;
    this.offset = offset;
    this.available = available;
    this.cellHeight = cellHeight;
    this.viewportHeight = viewportHeight;
    this.position = null;
    const visibility = available ? "visible" : "hidden";
    if (scrollbar.style.visibility !== visibility)
      scrollbar.style.visibility = visibility;
    setAttribute(scrollbar, "aria-valuemin", "0");
    setAttribute(scrollbar, "aria-valuemax", String(history));
    setAttribute(scrollbar, "aria-valuenow", String(history - offset));
    if (!available) return null;

    const height = `${viewportHeight + history * cellHeight}px`;
    if (content.style.height !== height) content.style.height = height;
    const target = (history - offset) * cellHeight;
    if (Math.round(scrollbar.scrollTop / cellHeight) !== history - offset) {
      scrollbar.scrollTop = target;
    }
    this.position = scrollbar.scrollTop;
    return this.position;
  }
}

function setAttribute(element: HTMLElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
