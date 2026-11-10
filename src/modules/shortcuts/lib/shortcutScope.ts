import type { ShortcutId } from "@/modules/shortcuts/shortcuts";

function isPaneSwapShortcut(id: ShortcutId): boolean {
  return (
    id === "pane.swapLeft" ||
    id === "pane.swapRight" ||
    id === "pane.swapUp" ||
    id === "pane.swapDown"
  );
}

export function shouldDisablePaneSwapShortcut(
  id: ShortcutId,
  terminalPaneCount: number | null,
): boolean {
  return (
    isPaneSwapShortcut(id) &&
    (terminalPaneCount === null || terminalPaneCount < 2)
  );
}

/**
 * Ask AI in a terminal with nothing selected would swallow its key. A
 * Ctrl+Shift chord is the app's alone (outside the Kitty protocol it reaches
 * the shell as a control byte nothing reads), so only other bindings, such as a
 * user's plain Ctrl+J (a newline), are left to the shell.
 */
export function shouldDisableAskSelection(
  event: Pick<KeyboardEvent, "ctrlKey" | "shiftKey">,
  inTerminal: () => boolean,
  hasSelection: () => boolean,
): boolean {
  if (event.ctrlKey && event.shiftKey) return false;
  return inTerminal() && !hasSelection();
}
