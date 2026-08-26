export type CompositionKeyEvent = {
  nativeEvent?: { isComposing?: boolean };
  isComposing?: boolean;
  key?: string;
  keyCode?: number;
};

/** Keys that can never carry IME composition input.
 *
 * macOS treats Option as a dead-key modifier, so WKWebView stamps keyCode 229
 * on every Option+key event even with no IME session active. Excluding these
 * keeps the fallback from swallowing Option+Arrow style navigation.
 */
const NON_COMPOSING_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Backspace",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/** True while an IME is still assembling a character.
 *
 * The Enter that confirms a candidate arrives as an ordinary keydown, so any
 * handler that submits on Enter fires mid-composition and sends half a word.
 * WebKit reports keyCode 229 on that Enter without setting isComposing, so the
 * flag alone is not enough. React exposes the native flag via nativeEvent.
 */
export function isComposingEvent(event: CompositionKeyEvent): boolean {
  if (event.nativeEvent?.isComposing === true) return true;
  if (event.isComposing === true) return true;
  if (event.keyCode !== 229) return false;
  return !NON_COMPOSING_KEYS.has(event.key ?? "");
}
