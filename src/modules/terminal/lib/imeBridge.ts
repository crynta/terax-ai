// Some macOS WebKit (WKWebView) builds deliver Korean/CJK IME through `input`
// events — `insertText` when a new glyph starts, `insertReplacementText` as
// the in-progress syllable is refined (ㅇ → 아 → 안) — and never fire the
// composition* events xterm understands. Left alone, xterm forwards the first
// jamo and silently drops every refinement, so 안녕 arrives as ㅇㄴ.
//
// This module is the pure decision core of the bridge: given the input event
// and xterm's key-tracking flags, it returns exactly what must be written to
// the PTY (erasing what it previously wrote with DEL where needed) so the
// shell always mirrors what the IME shows. Keeping it DOM-free locks the
// invariants under test — the DOM wiring lives in rendererPool, which also
// gates the bridge to macOS.
export type ImeBridgeState = {
  // Composition region this bridge last wrote to the PTY, verbatim. The next
  // replacement rewrites exactly this span — never more, so committed text
  // ahead of the region survives.
  pendingRegion: string;
  // Leaf the state belongs to. Slots are pooled across panes, so an ownership
  // transition must never let a stale region trigger erases in the new pane.
  leafId: number | null;
  // Set once a native `compositionstart` is observed. WKWebView versions that
  // fire real composition events are already handled by xterm end to end, and
  // a second delivery path would double-write, so the bridge stands down for
  // the rest of the terminal's life.
  nativeComposition: boolean;
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
  return { pendingRegion: "", leafId: null, nativeComposition: false };
}

// Composition ended or focus left the textarea: the region is final, nothing
// is left to refine.
export function resetImeBridge(state: ImeBridgeState): void {
  state.pendingRegion = "";
}

// The slot changed hands — released, rebound, or reacquired by the very same
// leaf. Drop the region *and* the ownership stamp so the first event of the
// new session can never be treated as a refinement of the old one.
export function releaseImeBridge(state: ImeBridgeState): void {
  state.pendingRegion = "";
  state.leafId = null;
}

// A native compositionstart proves xterm's own composition path is live here;
// stand down permanently so the two paths cannot both write.
export function noteNativeComposition(state: ImeBridgeState): void {
  state.nativeComposition = true;
  state.pendingRegion = "";
}

const NON_ASCII_RE = /[^\x20-\x7e]/;

// Length of the shared leading run of code points.
function commonPrefixLength(a: string[], b: string[]): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

// Returns the exact bytes to write to the PTY for this input event, or null
// when another path (xterm's keydown/keypress or its own _inputEvent) is
// responsible for delivering it.
export function imeBridgeInput(
  state: ImeBridgeState,
  leafId: number,
  e: ImeInputEvent,
  flags: XtermKeyFlags,
): string | null {
  if (state.nativeComposition) return null;

  if (state.leafId !== leafId) {
    state.pendingRegion = "";
    state.leafId = leafId;
  }

  if (e.inputType === "insertText") {
    // insertText opens a fresh composition region: whatever came before is
    // committed and must never be erased again.
    state.pendingRegion = e.data ?? "";
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
    // The event carries the whole rewritten region, which may hold a commit
    // plus a fresh composition (jamo carry-over: "간" + ㅏ → "가나"). Erasing
    // only the last glyph would leave the commit duplicated (가가난), and
    // erasing a fixed count would eat text ahead of the region. Diff the two
    // regions instead and rewrite only the tail that actually changed.
    const prev = [...state.pendingRegion];
    const next = [...e.data];
    const shared = commonPrefixLength(prev, next);
    state.pendingRegion = e.data;
    const erase = "\x7f".repeat(prev.length - shared);
    const write = next.slice(shared).join("");
    if (!erase && !write) return null;
    return erase + write;
  }

  return null;
}
