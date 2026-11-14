import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
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

const EMPTY_PASTE = "\x1b[200~\x1b[201~";

function harness(bracketedPaste: boolean) {
  const input = new FakeTextArea();
  const onData = vi.fn<(bytes: Uint8Array) => void>();
  const model = {
    cols: 80,
    rows: 24,
    modes: () => ({
      alternateScreen: false,
      bracketedPaste,
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
    encodeKey: () => new Uint8Array(),
    kittyKeyboardFlags: () => 0,
  } as unknown as GhosttyTerminalModelApi;
  const controller = new GhosttyInputController({
    model,
    input: input as unknown as HTMLTextAreaElement,
    pointerTarget: new FakeElement() as unknown as HTMLElement,
    cellSize: () => ({ width: 10, height: 20 }),
    onData,
    onCopy: () => false,
    isMac: true,
    isWindows: false,
  });
  const cmdV = () =>
    input.dispatchEvent(
      Object.assign(new Event("keydown", { bubbles: true, cancelable: true }), {
        key: "v",
        code: "KeyV",
        keyCode: 86,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: true,
        repeat: false,
        isComposing: false,
        getModifierState: () => false,
      }),
    );
  const sent = () =>
    onData.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes));
  return { controller, cmdV, sent };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Cmd+V when the clipboard has no text", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends an empty bracketed paste so the application can read an image", async () => {
    const { controller, cmdV, sent } = harness(true);
    cmdV();
    clipboard.resolve("");
    await settle();
    expect(sent()).toEqual([EMPTY_PASTE]);
    controller.dispose();
  });

  it("sends nothing outside bracketed paste mode", async () => {
    const { controller, cmdV, sent } = harness(false);
    cmdV();
    clipboard.resolve("");
    await settle();
    expect(sent()).toEqual([]);
    controller.dispose();
  });

  it("pastes the text when there is some", async () => {
    const { controller, cmdV, sent } = harness(true);
    cmdV();
    clipboard.resolve("hello");
    await settle();
    expect(sent()).toEqual([`\x1b[200~hello\x1b[201~`]);
    controller.dispose();
  });

  it("sends nothing after the controller is disposed", async () => {
    const { controller, cmdV, sent } = harness(true);
    cmdV();
    controller.dispose();
    clipboard.resolve("");
    await settle();
    expect(sent()).toEqual([]);
  });
});
