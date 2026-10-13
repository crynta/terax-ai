export function shouldTreatCloseAsTabClose(
  activeEl: Element | null,
  tabCount: number,
): boolean {
  if (tabCount < 1) return false;
  if (!activeEl) return false;
  return (
    activeEl.tagName === "IFRAME" ||
    Boolean(activeEl.closest("[data-preview-frame]"))
  );
}
