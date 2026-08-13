import {
  createImeBridgeState,
  type ImeBridgeState,
  type ImeInputEvent,
  imeBridgeInput,
  noteNativeComposition,
  releaseImeBridge,
  resetImeBridge,
  type XtermKeyFlags,
} from "@/modules/terminal/lib/imeBridge";
import { describe, expect, it } from "vitest";

const DEL = "\x7f";
const IDLE: XtermKeyFlags = { keyDownSeen: false, keyPressHandled: false };
const KEY_HELD: XtermKeyFlags = { keyDownSeen: true, keyPressHandled: false };
const AFTER_SPACE: XtermKeyFlags = { keyDownSeen: true, keyPressHandled: true };

// A shell line is what the user actually judges the bridge by, so the traces
// below assert the rendered line rather than the DEL/text bytes that produce
// it — a byte-level expectation happily passes while the line reads 가가난.
class TerminalLine {
  private cells: string[] = [];

  write(data: string): void {
    for (const cp of data) {
      if (cp === DEL) this.cells.pop();
      else this.cells.push(cp);
    }
  }

  get text(): string {
    return this.cells.join("");
  }
}

type Step = [inputType: string, data: string | null, flags?: XtermKeyFlags];

// Replays a captured macOS WKWebView event trace through the bridge onto a
// simulated line. `xtermEcho` mirrors the events xterm itself delivers when
// the bridge declines them, so the line reflects every write the PTY sees.
function replay(
  steps: Step[],
  opts: {
    state?: ImeBridgeState;
    line?: TerminalLine;
    leafId?: number;
    xtermEcho?: (e: ImeInputEvent, flags: XtermKeyFlags) => string;
  } = {},
): string {
  const state = opts.state ?? createImeBridgeState();
  const line = opts.line ?? new TerminalLine();
  const leafId = opts.leafId ?? 1;
  // What xterm itself puts on the wire for an event the bridge declined:
  // ASCII always rides the keydown/keypress path, non-ASCII only survives
  // xterm's _inputEvent while both key flags are clear. Replacements it
  // never understands at all.
  const echo =
    opts.xtermEcho ??
    ((e: ImeInputEvent, flags: XtermKeyFlags) => {
      if (e.inputType !== "insertText" || !e.data) return "";
      const ascii = !/[^\x20-\x7e]/.test(e.data);
      if (ascii) return e.data;
      return !flags.keyDownSeen && !flags.keyPressHandled ? e.data : "";
    });

  for (const [inputType, data, flags = IDLE] of steps) {
    const event: ImeInputEvent = { inputType, data, composed: true };
    const out = imeBridgeInput(state, leafId, event, flags);
    line.write(out ?? echo(event, flags));
  }
  return line.text;
}

describe("imeBridgeInput", () => {
  it("rewrites the in-progress syllable in place (ㅇ → 아 → 안)", () => {
    expect(
      replay([
        ["insertText", "ㅇ"],
        ["insertReplacementText", "아"],
        ["insertReplacementText", "안"],
      ]),
    ).toBe("안");
  });

  it("keeps the committed syllable exactly once across jamo carry-over (간 + ㅏ → 가나 → 가난)", () => {
    // The regression the byte-only assertion missed: the second carry-over
    // step used to erase one glyph and rewrite the whole region, landing on
    // 가가난.
    expect(
      replay([
        ["insertText", "ㄱ"],
        ["insertReplacementText", "가"],
        ["insertReplacementText", "간"],
        ["insertReplacementText", "가나"],
        ["insertReplacementText", "가난"],
      ]),
    ).toBe("가난");
  });

  it("survives a full multi-syllable word trace (안녕하세요)", () => {
    expect(
      replay([
        ["insertText", "ㅇ"],
        ["insertReplacementText", "아"],
        ["insertReplacementText", "안"],
        ["insertReplacementText", "안ㄴ"],
        ["insertReplacementText", "안녀"],
        ["insertReplacementText", "안녕"],
        ["insertReplacementText", "안녕ㅎ"],
        ["insertReplacementText", "안녕하"],
        ["insertReplacementText", "안녕하ㅅ"],
        ["insertReplacementText", "안녕하세"],
        ["insertReplacementText", "안녕하세ㅇ"],
        ["insertReplacementText", "안녕하세요"],
      ]),
    ).toBe("안녕하세요");
  });

  it("emits the minimal edit instead of rewriting the whole region", () => {
    const state = createImeBridgeState();
    imeBridgeInput(
      state,
      1,
      { inputType: "insertText", data: "ㄱ", composed: true },
      IDLE,
    );
    imeBridgeInput(
      state,
      1,
      { inputType: "insertReplacementText", data: "가나", composed: true },
      IDLE,
    );
    // Only the changed tail moves: 나 → 난 is one DEL and one glyph, not a
    // teardown of the committed 가.
    expect(
      imeBridgeInput(
        state,
        1,
        { inputType: "insertReplacementText", data: "가난", composed: true },
        IDLE,
      ),
    ).toBe(`${DEL}난`);
  });

  it("writes nothing when a replacement repeats the current region", () => {
    const state = createImeBridgeState();
    imeBridgeInput(
      state,
      1,
      { inputType: "insertText", data: "ㅇ", composed: true },
      IDLE,
    );
    imeBridgeInput(
      state,
      1,
      { inputType: "insertReplacementText", data: "안", composed: true },
      IDLE,
    );
    expect(
      imeBridgeInput(
        state,
        1,
        { inputType: "insertReplacementText", data: "안", composed: true },
        IDLE,
      ),
    ).toBeNull();
  });

  it("forwards non-ASCII insertText that xterm drops while a key is held", () => {
    const state = createImeBridgeState();
    expect(
      imeBridgeInput(
        state,
        1,
        { inputType: "insertText", data: "주", composed: true },
        KEY_HELD,
      ),
    ).toBe("주");
  });

  it("delivers the first syllable typed fast after a space exactly once", () => {
    // xterm drops it (stale _keyPressHandled), so only the bridge writes.
    expect(
      replay([
        ["insertText", " ", AFTER_SPACE],
        ["insertText", "ㄱ", AFTER_SPACE],
        ["insertReplacementText", "가"],
      ]),
    ).toBe(" 가");
  });

  it("never duplicates ASCII input handled by the keydown/keypress path", () => {
    const state = createImeBridgeState();
    expect(
      imeBridgeInput(
        state,
        1,
        { inputType: "insertText", data: " ", composed: true },
        AFTER_SPACE,
      ),
    ).toBeNull();
    expect(
      imeBridgeInput(
        state,
        1,
        { inputType: "insertText", data: "a", composed: true },
        KEY_HELD,
      ),
    ).toBeNull();
  });

  it("erases nothing after compositionend/blur reset", () => {
    const state = createImeBridgeState();
    const line = new TerminalLine();
    replay(
      [
        ["insertText", "ㅇ"],
        ["insertReplacementText", "안"],
      ],
      { state, line },
    );
    resetImeBridge(state);
    expect(replay([["insertReplacementText", "녀"]], { state, line })).toBe(
      "안녀",
    );
  });

  it("stands down once a native compositionstart is seen", () => {
    const state = createImeBridgeState();
    noteNativeComposition(state);
    expect(
      imeBridgeInput(
        state,
        1,
        { inputType: "insertReplacementText", data: "안", composed: true },
        IDLE,
      ),
    ).toBeNull();
    // Sticky: xterm owns this terminal's IME for good.
    expect(
      imeBridgeInput(
        state,
        1,
        { inputType: "insertText", data: "주", composed: true },
        KEY_HELD,
      ),
    ).toBeNull();
  });

  it("drops a mid-composition region when a native compositionstart arrives", () => {
    const state = createImeBridgeState();
    const line = new TerminalLine();
    replay(
      [
        ["insertText", "ㅇ"],
        ["insertReplacementText", "안"],
      ],
      { state, line },
    );
    noteNativeComposition(state);
    // xterm's own path now delivers everything; no stray DEL for 안.
    replay([["insertReplacementText", "녕"]], {
      state,
      line,
      xtermEcho: (e) => e.data ?? "",
    });
    expect(line.text).toBe("안녕");
  });

  it("drops stale pending state when the slot rebinds to another leaf", () => {
    const state = createImeBridgeState();
    const line = new TerminalLine();
    replay(
      [
        ["insertText", "ㅇ"],
        ["insertReplacementText", "안"],
      ],
      { state, line, leafId: 1 },
    );
    // Same slot, different pane: the old pane's glyph must not be erased.
    const other = new TerminalLine();
    expect(
      replay([["insertReplacementText", "가"]], {
        state,
        line: other,
        leafId: 2,
      }),
    ).toBe("가");
  });

  it("drops pending state when the same leaf releases and reacquires the slot", () => {
    const state = createImeBridgeState();
    replay(
      [
        ["insertText", "ㅇ"],
        ["insertReplacementText", "안"],
      ],
      { state, leafId: 7 },
    );
    // Release/reacquire by the identical leaf: the leafId guard alone cannot
    // see this transition, so the pool resets the bridge explicitly.
    releaseImeBridge(state);
    expect(
      replay([["insertReplacementText", "가"]], { state, leafId: 7 }),
    ).toBe("가");
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
