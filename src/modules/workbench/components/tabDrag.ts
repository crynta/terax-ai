import { create } from "zustand";
import { moveTabToCard, moveTabToSplit } from "../actions";
import { type DropZone, dropZoneAt } from "../model/dropZone";
import { locateTab } from "../model/workbench";
import { snapshot } from "../store";

export type DropTarget = {
  cardId: number;
  zone: DropZone;
  /** Insertion gap in the target card's strip, for a drop on its header. */
  index?: number;
};

type Rect = { left: number; top: number; width: number; height: number };

/** The parts of the element under the pointer the resolver reads. */
export type DropElement = {
  readonly dataset: Readonly<Record<string, string | undefined>>;
  closest(selector: string): DropElement | null;
  querySelectorAll(selector: string): ArrayLike<DropElement>;
  getBoundingClientRect(): Rect;
};

/**
 * Where a dragged tab would land given the element under the pointer: a card
 * header inserts at the gap under the pointer; a card's body stacks in its
 * middle or splits near an edge. Anything else is no target.
 */
export function resolveDropTarget(
  el: DropElement | null,
  x: number,
  y: number,
  cardOfTab: (tabId: number) => number | null,
): DropTarget | null {
  const header = el?.closest("[data-card-header]");
  if (header) {
    const tabs = Array.from(header.querySelectorAll("[data-tab-id]"));
    const index = tabs.findIndex((t) => {
      const r = t.getBoundingClientRect();
      return x < r.left + r.width / 2;
    });
    return {
      cardId: Number(header.dataset.cardHeader),
      zone: "stack",
      index: index === -1 ? tabs.length : index,
    };
  }
  const body = el?.closest("[data-tab-slot]");
  if (!body) return null;
  const cardId = cardOfTab(Number(body.dataset.tabSlot));
  if (cardId === null) return null;
  const r = body.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return {
    cardId,
    zone: dropZoneAt((x - r.left) / r.width, (y - r.top) / r.height),
  };
}

/** Where a tab dragged out of its strip would land; drives card overlays. */
export const useTabDrop = create<{ target: DropTarget | null }>(() => ({
  target: null,
}));

function targetAt(x: number, y: number): DropTarget | null {
  return resolveDropTarget(
    document.elementFromPoint(x, y) as DropElement | null,
    x,
    y,
    (tabId) => locateTab(snapshot(), tabId)?.cardId ?? null,
  );
}

/** Lets a tab strip hand a drag that left it to the cards of the task. */
export const tabDrag = {
  move(x: number, y: number) {
    const target = targetAt(x, y);
    const prev = useTabDrop.getState().target;
    if (
      prev?.cardId === target?.cardId &&
      prev?.zone === target?.zone &&
      prev?.index === target?.index
    )
      return;
    useTabDrop.setState({ target });
  },
  /** Applies the drop; false when there was no target (caller falls back). */
  drop(tabId: number): boolean {
    const { target } = useTabDrop.getState();
    useTabDrop.setState({ target: null });
    if (!target) return false;
    if (target.zone === "stack")
      moveTabToCard(tabId, target.cardId, target.index);
    else moveTabToSplit(tabId, target.cardId, target.zone);
    return true;
  },
  cancel() {
    if (useTabDrop.getState().target) useTabDrop.setState({ target: null });
  },
};
