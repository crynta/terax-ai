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
};

export type XtermKeyFlags = {
  keyDownSeen: boolean;
  keyPressHandled: boolean;
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
    // Fast IME input can inherit xterm's key flags from the previous key.
    // Correlated key data means xterm already sent this exact character.
    if (
      e.data &&
      e.composed &&
      NON_ASCII_RE.test(e.data) &&
      (flags.keyDownSeen || flags.keyPressHandled) &&
      !sentByXtermKey
    ) {
      return e.data;
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
