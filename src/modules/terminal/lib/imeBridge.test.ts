import {
  clearXtermKeyData,
  createImeBridgeState,
  type ImeBridgeState,
  type ImeInputEvent,
  imeBridgeInput,
  noteNativeComposition,
  noteXtermKeyData,
  resetImeBridge,
  transitionImeBridgeOwner,
  type XtermKeyFlags,
} from "@/modules/terminal/lib/imeBridge";
import { describe, expect, it } from "vitest";

const DEL = "\x7f";
const IDLE: XtermKeyFlags = { keyDownSeen: false, keyPressHandled: false };
const KEY_HELD: XtermKeyFlags = { keyDownSeen: true, keyPressHandled: false };
const AFTER_KEYPRESS: XtermKeyFlags = {
  keyDownSeen: true,
  keyPressHandled: true,
};

class TerminalLine {
  private cells: string[];

  constructor(initial = "") {
    this.cells = [...initial];
  }

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

type Step = [
  inputType: string,
  data: string | null,
  flags?: XtermKeyFlags,
  xtermKeyData?: string,
];

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
  const echo =
    opts.xtermEcho ??
    ((e: ImeInputEvent, flags: XtermKeyFlags) => {
      if (e.inputType !== "insertText" || !e.data) return "";
      const ascii = !/[^\x20-\x7e]/.test(e.data);
      if (ascii) return e.data;
      return !flags.keyDownSeen && !flags.keyPressHandled ? e.data : "";
    });

  for (const [inputType, data, flags = IDLE, xtermKeyData] of steps) {
    if (xtermKeyData !== undefined) {
      noteXtermKeyData(state, leafId, xtermKeyData);
      line.write(xtermKeyData);
    }
    const event: ImeInputEvent = { inputType, data, composed: true };
    const out = imeBridgeInput(state, leafId, event, flags);
    line.write(out ?? (xtermKeyData === undefined ? echo(event, flags) : ""));
  }
  return line.text;
}

describe("imeBridgeInput", () => {
  it("rewrites an in-progress syllable in place", () => {
    expect(
      replay([
        ["insertText", "ㅇ"],
        ["insertReplacementText", "아"],
        ["insertReplacementText", "안"],
      ]),
    ).toBe("안");
  });

  it("preserves the committed prefix across jamo carry-over", () => {
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

  it("replays a full multi-syllable word trace", () => {
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

  it("emits only the changed suffix", () => {
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
    expect(
      imeBridgeInput(
        state,
        1,
        { inputType: "insertReplacementText", data: "가난", composed: true },
        IDLE,
      ),
    ).toBe(`${DEL}난`);
  });

  it("writes nothing for an identical replacement", () => {
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

  it("forwards non-ASCII insertText dropped by xterm", () => {
    expect(
      imeBridgeInput(
        createImeBridgeState(),
        1,
        { inputType: "insertText", data: "주", composed: true },
        KEY_HELD,
      ),
    ).toBe("주");
  });

  it("forwards a non-composed non-ASCII commit xterm's gate drops (Shift+; first press)", () => {
    // WKWebView delivers the Chinese-IME full-width punctuation commit as
    // insertText with composed=false while the previous key's
    // keyPressHandled is still set: xterm's _inputEvent drops it, so the
    // bridge must compensate.
    expect(
      imeBridgeInput(
        createImeBridgeState(),
        1,
        { inputType: "insertText", data: "：", composed: false },
        { keyDownSeen: false, keyPressHandled: true },
      ),
    ).toBe("：");
  });

  it("forwards a composed non-ASCII commit while keyDownSeen is stale (#1112)", () => {
    expect(
      imeBridgeInput(
        createImeBridgeState(),
        1,
        { inputType: "insertText", data: "가", composed: true },
        KEY_HELD,
      ),
    ).toBe("가");
  });

  it("never forwards when xterm's gate will deliver (no double write)", () => {
    // composed=false + both flags clear: xterm's _inputEvent delivers this
    // insertText itself, so the bridge must stand down.
    expect(
      imeBridgeInput(
        createImeBridgeState(),
        1,
        { inputType: "insertText", data: "：", composed: false },
        IDLE,
      ),
    ).toBeNull();
  });

  it("never forwards a composed commit xterm will deliver (kds=false, kph=false)", () => {
    expect(
      imeBridgeInput(
        createImeBridgeState(),
        1,
        { inputType: "insertText", data: "あ", composed: true },
        { keyDownSeen: false, keyPressHandled: false },
      ),
    ).toBeNull();
  });

  it("delivers the first syllable typed fast after a space once", () => {
    expect(
      replay([
        ["insertText", " ", AFTER_KEYPRESS, " "],
        ["insertText", "ㄱ", AFTER_KEYPRESS],
        ["insertReplacementText", "가"],
      ]),
    ).toBe(" 가");
  });

  it("does not duplicate non-ASCII keydown or keypress data", () => {
    expect(
      replay([
        ["insertText", "Ж", KEY_HELD, "Ж"],
        ["insertText", "å", AFTER_KEYPRESS, "å"],
      ]),
    ).toBe("Жå");
  });

  it("consumes xterm key correlation after one input", () => {
    expect(
      replay([
        ["insertText", "å", AFTER_KEYPRESS, "å"],
        ["insertText", "å", AFTER_KEYPRESS],
      ]),
    ).toBe("åå");
  });

  it("forwards non-ASCII data after a different xterm key", () => {
    const state = createImeBridgeState();
    noteXtermKeyData(state, 1, "x");
    expect(
      imeBridgeInput(
        state,
        1,
        { inputType: "insertText", data: "주", composed: true },
        AFTER_KEYPRESS,
      ),
    ).toBe("주");
  });

  it("expires unmatched xterm key data on keyup", () => {
    const state = createImeBridgeState();
    noteXtermKeyData(state, 1, "å");
    clearXtermKeyData(state);
    expect(
      imeBridgeInput(
        state,
        1,
        { inputType: "insertText", data: "å", composed: true },
        AFTER_KEYPRESS,
      ),
    ).toBe("å");
  });

  it("forwards an ASCII IME commit dropped by the held-key gate (Shift+3 → '#')", () => {
    // Chinese-IME Shift+digit commits ASCII (@ # % & * +) as insertText with
    // isComposing=false while the still-held Shift keydown keeps xterm's
    // _keyDownSeen high — xterm's _inputEvent drops it, nothing else
    // delivers it (keydown was 229-swallowed), so the bridge must compensate.
    expect(
      imeBridgeInput(
        createImeBridgeState(),
        1,
        {
          inputType: "insertText",
          data: "#",
          composed: true,
          isComposing: false,
        },
        KEY_HELD,
      ),
    ).toBe("#");
  });

  it("never forwards keypress-delivered ASCII (kph=true, no double write)", () => {
    const state = createImeBridgeState();
    expect(
      imeBridgeInput(
        state,
        1,
        {
          inputType: "insertText",
          data: " ",
          composed: true,
          isComposing: false,
        },
        AFTER_KEYPRESS,
      ),
    ).toBeNull();
    // The A-Z/dead-key keypress path: xterm _keyPress delivered the char and
    // set _keyPressHandled; the following input event must not re-send it.
    expect(
      imeBridgeInput(
        state,
        1,
        {
          inputType: "insertText",
          data: "A",
          composed: true,
          isComposing: false,
        },
        AFTER_KEYPRESS,
      ),
    ).toBeNull();
  });

  it("never forwards in-progress ASCII composition text (composition-bypassing builds)", () => {
    // On WKWebView builds that skip composition events (#1112 path),
    // in-progress pinyin can surface as plain ASCII insertText; isComposing
    // stays true for those edits, so the bridge must leave them alone.
    expect(
      imeBridgeInput(
        createImeBridgeState(),
        1,
        {
          inputType: "insertText",
          data: "i",
          composed: true,
          isComposing: true,
        },
        KEY_HELD,
      ),
    ).toBeNull();
  });

  it("does not erase stale state after compositionend or blur", () => {
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

  it("stands down during a native composition session, then re-arms at compositionend", () => {
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
    expect(
      imeBridgeInput(
        state,
        1,
        { inputType: "insertText", data: "주", composed: true },
        KEY_HELD,
      ),
    ).toBeNull();

    // compositionend (or blur) resets the latch: the bridge must compensate
    // again afterwards.
    resetImeBridge(state);
    expect(
      imeBridgeInput(
        state,
        1,
        { inputType: "insertText", data: "주", composed: true },
        KEY_HELD,
      ),
    ).toBe("주");
  });

  it("re-arms after compositionend and compensates the dropped Shift+punct commit (WKWebView trace scene 1)", () => {
    // Measured trace: a Chinese-IME pinyin session latches nativeComposition;
    // after compositionend the user presses Shift+; — the insertText arrives
    // with composed=true while the still-held Shift keydown keeps xterm's
    // _keyDownSeen high, so xterm's gate drops it. With the session-scoped
    // latch the bridge must forward it (exactly once).
    const state = createImeBridgeState();
    noteNativeComposition(state);
    resetImeBridge(state); // compositionend
    expect(
      imeBridgeInput(
        state,
        1,
        { inputType: "insertText", data: "：", composed: true },
        KEY_HELD,
      ),
    ).toBe("：");
  });

  it("stands down for an insertText swept by xterm's pending composition finalize", () => {
    // Measured trace: the commit is delivered by CompositionHelper's 0ms
    // finalize diff (set at compositionend), never by a post-compositionend
    // insertText. Any insertText landing while that finalize send is pending
    // (sendingComposition=true) is swept into its textarea diff — the bridge
    // must not forward it even when the key flags say xterm's _inputEvent
    // gate drops it, or the commit/punct would be written twice.
    const state = createImeBridgeState();
    noteNativeComposition(state);
    resetImeBridge(state); // compositionend; finalize timer still pending
    expect(
      imeBridgeInput(
        state,
        1,
        { inputType: "insertText", data: "：", composed: true },
        { ...KEY_HELD, sendingComposition: true },
      ),
    ).toBeNull();
    // Once the finalize send has completed, compensation resumes.
    expect(
      imeBridgeInput(
        state,
        1,
        { inputType: "insertText", data: "：", composed: true },
        { ...KEY_HELD, sendingComposition: false },
      ),
    ).toBe("：");
  });

  it("keeps native composition ownership across slot transitions", () => {
    const state = createImeBridgeState();
    noteNativeComposition(state);
    transitionImeBridgeOwner(state, null);
    transitionImeBridgeOwner(state, 2);
    expect(
      imeBridgeInput(
        state,
        2,
        { inputType: "insertText", data: "주", composed: true },
        KEY_HELD,
      ),
    ).toBeNull();
  });

  it("drops a pending region when native composition starts", () => {
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
    replay([["insertReplacementText", "녕"]], {
      state,
      line,
      xtermEcho: (e) => e.data ?? "",
    });
    expect(line.text).toBe("안녕");
  });

  it("drops stale state when a slot changes owners", () => {
    const state = createImeBridgeState();
    replay(
      [
        ["insertText", "ㅇ"],
        ["insertReplacementText", "안"],
      ],
      { state, leafId: 1 },
    );
    transitionImeBridgeOwner(state, 2);
    const other = new TerminalLine("x");
    expect(
      replay([["insertReplacementText", "가"]], {
        state,
        line: other,
        leafId: 2,
      }),
    ).toBe("x가");
  });

  it("drops stale state when the same leaf releases and reacquires", () => {
    const state = createImeBridgeState();
    replay(
      [
        ["insertText", "ㅇ"],
        ["insertReplacementText", "안"],
      ],
      { state, leafId: 7 },
    );
    transitionImeBridgeOwner(state, null);
    transitionImeBridgeOwner(state, 7);
    const resumed = new TerminalLine("x");
    expect(
      replay([["insertReplacementText", "가"]], {
        state,
        line: resumed,
        leafId: 7,
      }),
    ).toBe("x가");
  });

  it("ignores unsupported and empty events", () => {
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
