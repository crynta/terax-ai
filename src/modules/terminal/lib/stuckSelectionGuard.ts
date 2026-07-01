type ClosestTarget = {
  closest?: (selector: string) => unknown;
};

export type TerminalSelectionSlot = {
  currentLeafId: number | null;
  term: {
    clearSelection(): void;
  };
};

export function isTerminalSelectionStart(
  event: Pick<MouseEvent, "button">,
  target: EventTarget | null,
): boolean {
  if (event.button !== 0) return false;
  const closest = (target as ClosestTarget | null)?.closest;
  return typeof closest === "function" && !!closest.call(target, ".xterm");
}

export function isReleasedMoveDuringSelection(
  trackingSelection: boolean,
  event: Pick<MouseEvent, "buttons">,
): boolean {
  return trackingSelection && event.buttons === 0;
}

export function clearLiveTerminalSelections(
  slots: Iterable<TerminalSelectionSlot>,
): void {
  for (const slot of slots) {
    if (slot.currentLeafId === null) continue;
    slot.term.clearSelection();
  }
}
