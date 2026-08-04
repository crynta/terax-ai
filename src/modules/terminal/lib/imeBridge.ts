// macOS WebKit (WKWebView) delivers Korean/CJK IME through `input` events —
// `insertText` when a new glyph starts, `insertReplacementText` as the
// in-progress syllable is refined (ㅇ → 아 → 안) — and never fires the
// composition* events xterm understands. Left alone, xterm forwards the
// first jamo and silently drops every refinement, so 안녕 arrives as ㅇㄴ.
//
// This module is the pure decision core of the bridge: given the input event
// and xterm's key-tracking flags, it returns exactly what must be written to
// the PTY (erasing the previously sent glyph with DEL where needed) so the
// shell always mirrors what the IME shows. Keeping it DOM-free locks the
// invariants under test — the DOM wiring lives in rendererPool.
export type ImeBridgeState = {
  // Last uncommitted glyph already sent to the PTY. The next replacement
  // erases exactly this many code points before writing the refinement.
  pendingGlyph: string;
  // Leaf the state belongs to. Slots are pooled across panes, so a rebind
  // must never let a stale glyph trigger erases in the new pane.
  leafId: number | null;
};

export type ImeInputEvent = {
  inputType: string;
  data: string | null;
  composed: boolean;
};

// Mirror of xterm's private input bookkeeping at the moment the event fired:
// _keyDownSeen (keydown seen, keyup still pending) and _keyPressHandled
// (stale until the next real keypress). xterm's _inputEvent refuses
// insertText while either is set.
export type XtermKeyFlags = {
  keyDownSeen: boolean;
  keyPressHandled: boolean;
};

export function createImeBridgeState(): ImeBridgeState {
  return { pendingGlyph: "", leafId: null };
}

// Composition ended or focus left the textarea: the glyph is final,
// nothing is left to refine.
export function resetImeBridge(state: ImeBridgeState): void {
  state.pendingGlyph = "";
}

function lastCodePoint(s: string): string {
  const cps = [...s];
  return cps.length ? cps[cps.length - 1] : "";
}

const NON_ASCII_RE = /[^\x20-\x7e]/;

// Returns the exact bytes to write to the PTY for this input event, or null
// when another path (xterm's keydown/keypress or its own _inputEvent) is
// responsible for delivering it.
export function imeBridgeInput(
  state: ImeBridgeState,
  leafId: number,
  e: ImeInputEvent,
  flags: XtermKeyFlags,
): string | null {
  if (state.leafId !== leafId) {
    state.pendingGlyph = "";
    state.leafId = leafId;
  }

  if (e.inputType === "insertText") {
    // Only the last code point can still be refined by the IME — anything
    // before it is already committed and must never be erased again.
    state.pendingGlyph = lastCodePoint(e.data ?? "");
    // The macOS IME fires input BEFORE keydown, so during fast typing the
    // previous key's keyup hasn't landed and xterm's _inputEvent drops the
    // committed syllable. Replicate its exact drop condition and forward
    // the data ourselves — but only for non-ASCII (IME) text: ASCII input
    // (space, English letters) reaches the PTY through the keydown/keypress
    // path, and Hangul never fires keypress, so the stale _keyPressHandled
    // flag must not veto it.
    if (
      e.data &&
      e.composed &&
      NON_ASCII_RE.test(e.data) &&
      (flags.keyDownSeen || flags.keyPressHandled)
    ) {
      return e.data;
    }
    return null;
  }

  if (e.inputType === "insertReplacementText" && e.data) {
    const erase = "\x7f".repeat([...state.pendingGlyph].length);
    // A replacement can carry a commit plus a new composition in one event
    // (jamo carry-over: "간" + ㅏ → "가나"). Track only the final code
    // point — the next replacement targets just that glyph, and erasing
    // more would swallow the committed character.
    state.pendingGlyph = lastCodePoint(e.data);
    return erase + e.data;
  }

  return null;
}
