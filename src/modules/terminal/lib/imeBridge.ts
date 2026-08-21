export type ImeBridgeState = {
  pendingRegion: string;
  leafId: number | null;
  nativeComposition: boolean;
  xtermKeyData: string | null;
};

export type ImeInputEvent = {
  inputType: string;
  data: string | null;
  composed: boolean;
  /** InputEvent.isComposing — false on IME commits, true on in-progress text. */
  isComposing?: boolean;
};

export type XtermKeyFlags = {
  keyDownSeen: boolean;
  keyPressHandled: boolean;
  /**
   * xterm CompositionHelper._isSendingComposition: true between
   * compositionend and its 0ms finalize timer, whose textarea diff delivers
   * anything that just landed — the bridge must stand down in that window.
   */
  sendingComposition?: boolean;
};

export function createImeBridgeState(): ImeBridgeState {
  return {
    pendingRegion: "",
    leafId: null,
    nativeComposition: false,
    xtermKeyData: null,
  };
}

function clearTransientState(state: ImeBridgeState): void {
  state.pendingRegion = "";
  state.xtermKeyData = null;
}

export function resetImeBridge(state: ImeBridgeState): void {
  clearTransientState(state);
  // Session-scoped latch: compositionstart sets it, compositionend/blur
  // clears it here. A permanent latch disables the bridge after the first
  // IME session, while xterm's input gate drops every Shift+punct commit
  // whose insertText arrives with _keyDownSeen held high by the still-held
  // Shift keydown — the "press twice" bug (#983, WKWebView trace-verified).
  state.nativeComposition = false;
}

export function transitionImeBridgeOwner(
  state: ImeBridgeState,
  leafId: number | null,
): void {
  clearTransientState(state);
  state.leafId = leafId;
}

export function noteNativeComposition(state: ImeBridgeState): void {
  state.nativeComposition = true;
  clearTransientState(state);
}

export function noteXtermKeyData(
  state: ImeBridgeState,
  leafId: number,
  data: string,
): void {
  if (state.nativeComposition) return;
  if (state.leafId !== leafId) transitionImeBridgeOwner(state, leafId);
  state.xtermKeyData = data;
}

export function clearXtermKeyData(state: ImeBridgeState): void {
  state.xtermKeyData = null;
}

const NON_ASCII_RE = /[^\x20-\x7e]/;

function commonPrefixLength(a: string[], b: string[]): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

export function imeBridgeInput(
  state: ImeBridgeState,
  leafId: number,
  e: ImeInputEvent,
  flags: XtermKeyFlags,
): string | null {
  if (state.nativeComposition) return null;
  if (state.leafId !== leafId) transitionImeBridgeOwner(state, leafId);

  const sentByXtermKey =
    e.inputType === "insertText" &&
    e.data !== null &&
    state.xtermKeyData === e.data;
  state.xtermKeyData = null;

  if (e.inputType === "insertText") {
    state.pendingRegion = e.data ?? "";
    // Mirror xterm CoreBrowserTerminal._inputEvent's delivery gate:
    //   xterm delivers ⟺ data && inputType==='insertText'
    //     && (!composed || !keyDownSeen) && !keyPressHandled
    //   (Terax never enables screenReaderMode, which would also gate it.)
    // Plus one composition-lifecycle clause: while the finalize send is
    // pending (sendingComposition), the 0ms textarea diff delivers anything
    // that just landed — including this event's text — so xterm effectively
    // owns it.
    // xterm's own listener runs first on this same event and does not
    // mutate the flags, so the mirror is exact and order-independent:
    // whatever xterm drops, the bridge forwards — exactly once.
    const xtermWillDeliver =
      ((!e.composed || !flags.keyDownSeen) && !flags.keyPressHandled) ||
      flags.sendingComposition === true;
    if (e.data && !xtermWillDeliver && !sentByXtermKey) {
      if (NON_ASCII_RE.test(e.data)) return e.data;
      // ASCII: forward only a provable IME commit — never key-delivered
      // text (double-write) or in-progress composition (raw pinyin leak):
      //  - !isComposing guards composition-bypassing WKWebView builds
      //    (#1112), where in-progress pinyin can surface as plain insertText.
      //  - !keyPressHandled guards keypress-delivered ASCII (xterm's A-Z /
      //    dead-key path): that input event was dropped because the keypress
      //    already sent it.
      // What remains is an IME commit with no keypress, e.g. Chinese-IME
      // Shift+3 → "#" dropped by the held-Shift keydown's _keyDownSeen.
      if (!e.isComposing && !flags.keyPressHandled) return e.data;
    }
    return null;
  }

  if (e.inputType === "insertReplacementText" && e.data) {
    // Replacement data can include committed text plus a new composition.
    // Rewrite only the changed code-point suffix to preserve that commit.
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
