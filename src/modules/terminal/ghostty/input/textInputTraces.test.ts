import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeElement, FakeTextArea } from "./fakeTextArea";
import { GhosttyInputController } from "./GhosttyInputController";

/**
 * Replays the DOM event sequences real keyboards and input methods produce and
 * checks that every character reaches the PTY exactly once, in order. The
 * sequences are the documented ones of each platform's text input stack.
 */

type Step =
  | ["keydown" | "keyup", Partial<KeyboardEvent>]
  | ["compositionstart" | "compositionupdate" | "compositionend", string?]
  | ["beforeinput", string, string?];

function harness(over: { isMac?: boolean } = {}) {
  const input = new FakeTextArea();
  const sent: string[] = [];
  const cursor = { x: 4, y: 2 };
  const model = {
    cols: 80,
    rows: 24,
    modes: () => ({
      alternateScreen: false,
      bracketedPaste: false,
      focusReporting: false,
      mouseTracking: false,
      synchronizedOutput: false,
    }),
    mode: () => false,
    scrollToBottom: () => false,
    scrollPosition: () => ({ offset: 0, history: 0 }),
    scrollBy: () => false,
    cursor: () => ({
      ...cursor,
      visible: true,
      blinking: false,
      style: "block",
    }),
    kittyKeyboardFlags: () => 0,
    encodeKey: (event: { utf8?: string }) =>
      new TextEncoder().encode(event.utf8 ?? ""),
  } as unknown as GhosttyTerminalModelApi;
  const controller = new GhosttyInputController({
    model,
    input: input as unknown as HTMLTextAreaElement,
    pointerTarget: new FakeElement() as unknown as HTMLElement,
    cellSize: () => ({ width: 10, height: 20 }),
    gridShiftY: () => 0,
    isMac: over.isMac ?? false,
    onCopy: () => false,
    onData: (bytes) => sent.push(new TextDecoder().decode(bytes)),
  });
  const play = (steps: readonly Step[]) => {
    for (const [type, a, b] of steps) {
      if (type === "keydown" || type === "keyup") {
        input.dispatchEvent(
          Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
            key: "",
            code: "",
            keyCode: 0,
            altKey: false,
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            repeat: false,
            isComposing: false,
            getModifierState: () => false,
            ...(a as Partial<KeyboardEvent>),
          }),
        );
      } else if (type === "beforeinput") {
        input.dispatchEvent(
          Object.assign(new Event(type, { cancelable: true }), {
            inputType: b ?? "insertText",
            data: a,
            isComposing: false,
          }),
        );
      } else {
        input.dispatchEvent(Object.assign(new Event(type), { data: a ?? "" }));
      }
    }
  };
  return { input, sent, cursor, controller, play, text: () => sent.join("") };
}

describe("text input traces", () => {
  let h: ReturnType<typeof harness>;
  afterEach(() => h.controller.dispose());

  it("types a plain accented key once, even if the platform also commits it", () => {
    h = harness();
    h.play([
      ["keydown", { key: "ñ", code: "Semicolon", keyCode: 192 }],
      ["beforeinput", "ñ"],
      ["keyup", { key: "ñ", code: "Semicolon", keyCode: 192 }],
    ]);
    expect(h.text()).toBe("ñ");
  });

  it("types the same character repeatedly without losing any", () => {
    h = harness();
    for (let i = 0; i < 5; i++)
      h.play([
        ["keydown", { key: "ñ", code: "Semicolon", keyCode: 192 }],
        ["keyup", { key: "ñ", code: "Semicolon", keyCode: 192 }],
      ]);
    expect(h.text()).toBe("ñññññ");
  });

  it("commits a macOS dead-key sequence once (Option+e, e)", () => {
    h = harness({ isMac: true });
    h.play([
      ["keydown", { key: "Dead", code: "KeyE", keyCode: 229, altKey: true }],
      ["compositionstart"],
      ["compositionupdate", "´"],
      ["keyup", { key: "e", code: "KeyE", keyCode: 69 }],
      ["keydown", { key: "e", code: "KeyE", keyCode: 229, isComposing: true }],
      ["compositionend", "é"],
      ["beforeinput", "é", "insertFromComposition"],
      ["keyup", { key: "e", code: "KeyE", keyCode: 69 }],
    ]);
    expect(h.text()).toBe("é");
  });

  it("commits a GTK dead-key compose with composition events and a trailing insertText once", () => {
    h = harness();
    h.play([
      ["keydown", { key: "Dead", code: "Quote", keyCode: 229 }],
      ["compositionstart"],
      ["compositionupdate", "¨"],
      ["keydown", { key: "o", code: "KeyO", keyCode: 229, isComposing: true }],
      ["compositionend", "ö"],
      ["beforeinput", "ö"],
    ]);
    expect(h.text()).toBe("ö");
  });

  it("commits a GTK input-method string that arrives without any composition event", () => {
    h = harness();
    h.play([
      ["keydown", { key: "Unidentified", code: "", keyCode: 229 }],
      ["beforeinput", "我"],
      ["keyup", { key: "Unidentified", code: "", keyCode: 229 }],
      ["keydown", { key: "Process", code: "", keyCode: 229 }],
      ["beforeinput", "本机"],
    ]);
    expect(h.text()).toBe("我本机");
  });

  it("does not replay earlier commits on later keystrokes (fcitx5 pinyin)", () => {
    h = harness();
    for (const word of ["我本机", "打字", "你好"])
      h.play([
        ["keydown", { key: "Process", keyCode: 229, isComposing: true }],
        ["compositionstart"],
        ["compositionupdate", "pinyin"],
        ["compositionend", word],
        ["beforeinput", word],
        ["keyup", { key: "Process", keyCode: 229 }],
      ]);
    expect(h.text()).toBe("我本机打字你好");
    expect(h.input.value).toBe("");
  });

  it("sends nothing while a composition is open and the text at its end", () => {
    h = harness();
    h.play([
      ["compositionstart"],
      ["keydown", { key: "Process", keyCode: 229, isComposing: true }],
      ["beforeinput", "n", "insertCompositionText"],
      ["compositionupdate", "ni"],
      ["keydown", { key: "ArrowDown", keyCode: 229, isComposing: true }],
      ["keydown", { key: "Enter", keyCode: 229, isComposing: true }],
    ]);
    expect(h.sent).toEqual([]);
    h.play([["compositionend", "你"]]);
    expect(h.text()).toBe("你");
  });

  it("does not submit when Safari reports the committing Enter after compositionend", () => {
    h = harness({ isMac: true });
    h.play([
      ["compositionstart"],
      ["compositionupdate", "nihao"],
      ["compositionend", "你好"],
      ["keydown", { key: "Enter", code: "Enter", keyCode: 229 }],
      ["keyup", { key: "Enter", code: "Enter", keyCode: 13 }],
    ]);
    expect(h.text()).toBe("你好");
  });

  it("keeps every character of an IME that commits before the key event (Doubao, English mode)", () => {
    h = harness({ isMac: true });
    const typed = "qwer1234qqqq";
    for (const character of typed)
      h.play([
        ["beforeinput", character],
        ["keydown", { key: character, code: "", keyCode: 229 }],
      ]);
    for (const character of typed)
      h.play([["keyup", { key: character, code: "", keyCode: 229 }]]);
    expect(h.text()).toBe(typed);
  });

  it("keeps fast typing on a plain keyboard intact", () => {
    h = harness({ isMac: true });
    const typed = "pwd clear hello";
    const steps: Step[] = [];
    for (const character of typed) {
      const code =
        character === " " ? "Space" : `Key${character.toUpperCase()}`;
      steps.push(["keydown", { key: character, code, keyCode: 65 }]);
    }
    for (const character of typed) {
      const code =
        character === " " ? "Space" : `Key${character.toUpperCase()}`;
      steps.push(["keyup", { key: character, code, keyCode: 65 }]);
    }
    h.play(steps);
    expect(h.text()).toBe(typed);
  });

  describe("composition anchor", () => {
    it("moves the input onto the cursor cell for the composition and back", () => {
      h = harness();
      h.input.style.left = "0px";
      h.input.style.top = "0px";
      h.input.style.width = "1px";
      h.input.style.height = "1px";
      h.play([["compositionstart"]]);
      expect(h.input.style.left).toBe("40px");
      expect(h.input.style.top).toBe("40px");
      expect(h.input.style.width).toBe("10px");
      expect(h.input.style.height).toBe("20px");
      h.play([["compositionend", "あ"]]);
      expect(h.input.style.left).toBe("0px");
      expect(h.input.style.top).toBe("0px");
      expect(h.input.style.width).toBe("1px");
      expect(h.input.style.height).toBe("1px");
    });

    it("stays put while the program keeps moving the cursor", () => {
      h = harness();
      h.play([["compositionstart"]]);
      for (let i = 0; i < 20; i++) {
        h.cursor.x = 10 + i;
        h.cursor.y = i;
        h.play([["compositionupdate", "ni"]]);
      }
      expect(h.input.style.left).toBe("40px");
      expect(h.input.style.top).toBe("40px");
    });

    it("never rewrites the field while composing", () => {
      h = harness({ isMac: true });
      h.input.value = "preedit";
      h.input.setSelectionRange(2, 4);
      h.play([["compositionstart"]]);
      const value = vi.spyOn(h.input, "value", "set");
      h.play([
        ["compositionupdate", "ni"],
        ["keydown", { key: "Process", keyCode: 229, isComposing: true }],
        ["keyup", { key: "Process", keyCode: 229 }],
      ]);
      expect(value).not.toHaveBeenCalled();
      expect(h.input.selectionStart).toBe(2);
      expect(h.input.selectionEnd).toBe(4);
    });

    it("restores the field when focus leaves mid-composition", () => {
      h = harness();
      h.input.style.left = "0px";
      h.play([["compositionstart"]]);
      h.input.dispatchEvent(new Event("blur"));
      expect(h.input.style.left).toBe("0px");
    });
  });
});
