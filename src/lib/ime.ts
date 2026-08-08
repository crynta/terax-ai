/**
 * True when a keyboard event belongs to an active IME composition session
 * (e.g. typing Chinese pinyin, Japanese kana, Korean jamo). While composing,
 * keys such as Enter commit the in-progress candidate into the field and must
 * not trigger app-level shortcuts like submitting a chat message.
 *
 * `keyCode === 229` ("Process") is what Chromium reports for every key pressed
 * inside an IME session before `isComposing` has been set — notably the Enter
 * that confirms a candidate on macOS — so we guard on both. The terminal's key
 * handler uses the same check (see modules/terminal/lib/rendererPool.ts).
 */
export function isImeComposing(e: {
  isComposing: boolean;
  keyCode: number;
}): boolean {
  return e.isComposing || e.keyCode === 229;
}
