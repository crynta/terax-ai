import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import { KeyAction, type KeyEvent, Mods } from "@terax/ghostty-core/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeElement, FakeTextArea } from "./fakeTextArea";
import { GhosttyInputController } from "./GhosttyInputController";

const clipboard = vi.hoisted(() => ({
  resolve: (_text: string) => {},
}));

vi.mock("@/modules/terminal/lib/terminalClipboard", () => ({
  readTerminalClipboard: () =>
    new Promise<string>((resolve) => {
      clipboard.resolve = resolve;
    }),
}));

const PRESS = "\x1b[118;5u";
const RELEASE = "\x1b[118;5:3u";

function harness(flags: number) {
  const input = new FakeTextArea();
  const onData = vi.fn<(bytes: Uint8Array) => void>();
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
      x: 0,
      y: 0,
      visible: true,
      blinking: false,
      style: "block",
    }),
    encodeKey: (event: KeyEvent) =>
      new TextEncoder().encode(
        flags === 0
          ? "\x16"
          : event.action === KeyAction.RELEASE
            ? (event.mods & Mods.CTRL) !== 0
              ? RELEASE
              : "\x1b[118;1:3u"
            : PRESS,
      ),
    kittyKeyboardFlags: () => flags,
  } as unknown as GhosttyTerminalModelApi;
  const controller = new GhosttyInputController({
    model,
    input: input as unknown as HTMLTextAreaElement,
    pointerTarget: new FakeElement() as unknown as HTMLElement,
    cellSize: () => ({ width: 10, height: 20 }),
    onData,
    onCopy: () => false,
    isMac: false,
    isWindows: true,
  });
  const key = (type: "keydown" | "keyup", repeat = false, ctrlKey = true) =>
    input.dispatchEvent(
      Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
        key: "v",
        code: "KeyV",
        keyCode: 86,
        ctrlKey,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        repeat,
        isComposing: false,
        getModifierState: () => false,
      }),
    );
  const sent = () =>
    onData.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes));
  return { controller, input, key, sent };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Ctrl+V forwarded as a key when the clipboard has no text", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([false, true])(
    "uses V's release modifiers even when the clipboard resolves late (%s)",
    async (late) => {
      const { controller, key, sent } = harness(3);
      try {
        key("keydown");
        if (late) key("keyup", false, false);
        clipboard.resolve("");
        await settle();
        if (!late) key("keyup", false, false);
        expect(sent()).toEqual([PRESS, "\x1b[118;1:3u"]);
      } finally {
        controller.dispose();
      }
    },
  );

  it("does not replace a pending press when the held paste key repeats", async () => {
    const { controller, key, sent } = harness(3);
    try {
      key("keydown");
      const firstRead = clipboard.resolve;
      key("keydown", true);
      const repeatRead = clipboard.resolve;
      key("keyup");
      firstRead("");
      await settle();
      expect(sent()).toEqual([PRESS, RELEASE]);
      expect(repeatRead).toBe(firstRead);
    } finally {
      controller.dispose();
    }
  });

  it("still accepts a separate paste press while an earlier read is pending", async () => {
    const { controller, key, sent } = harness(3);
    try {
      key("keydown");
      const firstRead = clipboard.resolve;
      key("keyup");
      key("keydown");
      const secondRead = clipboard.resolve;
      key("keyup");
      expect(secondRead).not.toBe(firstRead);
      firstRead("");
      secondRead("");
      await settle();
      expect(sent()).toEqual([PRESS, RELEASE, PRESS, RELEASE]);
    } finally {
      controller.dispose();
    }
  });

  it("sends the release with the press when the key is up before the read ends", async () => {
    const { controller, key, sent } = harness(3);
    key("keydown");
    key("keyup");
    expect(sent()).toEqual([]);
    clipboard.resolve("");
    await settle();
    expect(sent()).toEqual([PRESS, RELEASE]);
    controller.dispose();
  });

  it("releases on the key up when it comes after the read", async () => {
    const { controller, key, sent } = harness(3);
    key("keydown");
    clipboard.resolve("");
    await settle();
    expect(sent()).toEqual([PRESS]);
    key("keyup");
    expect(sent()).toEqual([PRESS, RELEASE]);
    controller.dispose();
  });

  it("releases when the window loses focus before the read ends", async () => {
    const { controller, input, key, sent } = harness(3);
    key("keydown");
    input.dispatchEvent(new Event("blur"));
    clipboard.resolve("");
    await settle();
    expect(sent()).toEqual([PRESS, RELEASE]);
    controller.dispose();
  });

  it("sends nothing but the text when the clipboard has some", async () => {
    const { controller, key, sent } = harness(3);
    key("keydown");
    key("keyup");
    clipboard.resolve("pasted");
    await settle();
    expect(sent()).toEqual(["pasted"]);
    controller.dispose();
  });

  it("has no release to report outside the key event protocol", async () => {
    const { controller, key, sent } = harness(0);
    key("keydown");
    clipboard.resolve("");
    await settle();
    key("keyup");
    expect(sent()).toEqual(["\x16"]);
    controller.dispose();
  });
});
