/** Decide whether the AI composer should submit on this Enter keydown. */
export type ComposerEnterEvent = {
  key: string;
  shiftKey: boolean;
  /** True while IME composition is active (`KeyboardEvent.isComposing`). */
  isComposing?: boolean;
  /**
   * Chromium "Process" keyCode. macOS reports 229 for the Enter that confirms
   * an IME candidate before `isComposing` flips (see terminal IME guard).
   */
  keyCode?: number;
  /**
   * True for a short window after `paste` / `insertFromPaste`. On Windows
   * WebView2, multiline clipboard paste can synthesize Enter keydowns for
   * each newline; those must not submit the composer.
   */
  isPasting?: boolean;
  /** Ctrl/Meta/Alt held — e.g. Ctrl still down during Ctrl+V paste synth. */
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
};

export function shouldSubmitComposerEnter(e: ComposerEnterEvent): boolean {
  if (e.key !== "Enter") return false;
  if (e.shiftKey) return false;
  if (e.isComposing || e.keyCode === 229) return false;
  if (e.isPasting) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return true;
}
