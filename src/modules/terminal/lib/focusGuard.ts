/** The parts of an element the focus guard reads (tests pass plain objects). */
export type FocusCandidate = {
  readonly tagName: string;
  readonly isContentEditable?: boolean;
  closest(selector: string): unknown;
};

const TEXT_ENTRY = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Whether code may move keyboard focus from `active` into a workbench view.
 *
 * - Inside the workbench, focus moves between views (terminal input, the code
 *   editor, tab pills) but never leaves a text field such as a preview's
 *   address bar or a tab being renamed.
 * - Outside it, only the app header's controls (new task, a task's tab) give
 *   focus up; the sidebar, the chat panel and dialogs keep it.
 */
export function focusIsMovable(active: FocusCandidate | null): boolean {
  if (!active || active.tagName === "BODY") return true;
  if (active.closest("[data-terminal-stack]")) {
    if (active.closest("[data-pane-leaf]") || active.closest(".cm-editor"))
      return true;
    return !(TEXT_ENTRY.has(active.tagName) || active.isContentEditable);
  }
  if (TEXT_ENTRY.has(active.tagName) || active.isContentEditable) return false;
  return !!active.closest("[data-app-header]");
}

/** The browser's focused element, as the guard sees it. */
export function currentFocus(): FocusCandidate | null {
  return typeof document === "undefined"
    ? null
    : (document.activeElement as FocusCandidate | null);
}
