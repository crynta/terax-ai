import {
  createImeBridgeState,
  type ImeBridgeState,
  imeBridgeInput,
  resetImeBridge,
  type XtermKeyFlags,
} from "@/modules/terminal/lib/imeBridge";
import { describe, expect, it } from "vitest";

const DEL = "\x7f";
const IDLE: XtermKeyFlags = { keyDownSeen: false, keyPressHandled: false };
const KEY_HELD: XtermKeyFlags = { keyDownSeen: true, keyPressHandled: false };
const AFTER_SPACE: XtermKeyFlags = { keyDownSeen: true, keyPressHandled: true };

function insertText(
  state: ImeBridgeState,
  data: string,
  flags: XtermKeyFlags = IDLE,
  leafId = 1,
): string | null {
  return imeBridgeInput(
    state,
    leafId,
    { inputType: "insertText", data, composed: true },
    flags,
  );
}

function replacement(
  state: ImeBridgeState,
  data: string,
  flags: XtermKeyFlags = IDLE,
  leafId = 1,
): string | null {
  return imeBridgeInput(
    state,
    leafId,
    { inputType: "insertReplacementText", data, composed: true },
    flags,
  );
}

describe("imeBridgeInput", () => {
  it("rewrites the in-progress syllable in place (ㅇ → 아 → 안)", () => {
    const state = createImeBridgeState();
    expect(insertText(state, "ㅇ")).toBeNull(); // xterm forwards it
    expect(replacement(state, "아")).toBe(`${DEL}아`);
    expect(replacement(state, "안")).toBe(`${DEL}안`);
  });

  it("never erases the committed syllable on jamo carry-over (간 + ㅏ → 가나)", () => {
    const state = createImeBridgeState();
    insertText(state, "ㄱ");
    replacement(state, "가");
    replacement(state, "간");
    // One event commits 가 and opens 나 — only 나 stays refinable.
    expect(replacement(state, "가나")).toBe(`${DEL}가나`);
    expect(replacement(state, "가난")).toBe(`${DEL}가난`);
  });

  it("forwards non-ASCII insertText that xterm drops while a key is held", () => {
    const state = createImeBridgeState();
    expect(insertText(state, "주", KEY_HELD)).toBe("주");
  });

  it("forwards the first syllable typed fast after a space (stale keypress flag)", () => {
    const state = createImeBridgeState();
    expect(insertText(state, "ㄱ", AFTER_SPACE)).toBe("ㄱ");
  });

  it("leaves insertText to xterm when both key flags are clear", () => {
    const state = createImeBridgeState();
    expect(insertText(state, "요", IDLE)).toBeNull();
  });

  it("never duplicates ASCII input handled by the keydown/keypress path", () => {
    const state = createImeBridgeState();
    expect(insertText(state, " ", AFTER_SPACE)).toBeNull();
    expect(insertText(state, "a", KEY_HELD)).toBeNull();
  });

  it("erases nothing after compositionend/blur reset", () => {
    const state = createImeBridgeState();
    insertText(state, "ㅇ");
    replacement(state, "안");
    resetImeBridge(state);
    expect(replacement(state, "녀")).toBe("녀");
  });

  it("drops stale pending state when the slot rebinds to another leaf", () => {
    const state = createImeBridgeState();
    insertText(state, "ㅇ", IDLE, 1);
    replacement(state, "안", IDLE, 1);
    // Same slot, different pane: the old pane's glyph must not be erased.
    expect(replacement(state, "가", IDLE, 2)).toBe("가");
  });

  it("ignores events it does not own (deletes, line breaks, empty data)", () => {
    const state = createImeBridgeState();
    expect(
      imeBridgeInput(
        state,
        1,
        { inputType: "deleteContentBackward", data: null, composed: true },
        IDLE,
      ),
    ).toBeNull();
    expect(
      imeBridgeInput(
        state,
        1,
        { inputType: "insertReplacementText", data: null, composed: true },
        IDLE,
      ),
    ).toBeNull();
  });
});
