import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeElement, FakeTextArea } from "./fakeTextArea";

type Failures = { mouse?: number; ime?: number };

/** A controller whose cold modules fail to load the given number of times. */
async function controllerWith(failures: Failures) {
  const loads = { mouse: 0, ime: 0 };
  vi.resetModules();
  vi.doMock("./TerminalMouse", async (importOriginal) => {
    if (++loads.mouse <= (failures.mouse ?? 0)) throw new Error("chunk failed");
    return importOriginal();
  });
  vi.doMock("./ImeAnchor", async (importOriginal) => {
    if (++loads.ime <= (failures.ime ?? 0)) throw new Error("chunk failed");
    return importOriginal();
  });
  const { GhosttyInputController } = await import("./GhosttyInputController");
  const pointer = new FakeElement();
  const input = new FakeTextArea();
  const onData = vi.fn<(bytes: Uint8Array) => void>();
  const model = {
    cols: 80,
    rows: 24,
    modes: () => ({
      alternateScreen: false,
      bracketedPaste: false,
      focusReporting: false,
      mouseTracking: true,
      synchronizedOutput: false,
    }),
    mode: (value: number) => value === 1006,
    scrollPosition: () => ({ offset: 0, history: 0 }),
    scrollBy: () => false,
    cursor: () => ({
      x: 3,
      y: 0,
      visible: true,
      blinking: false,
      style: "block",
    }),
    encodeKey: () => new Uint8Array(0),
    kittyKeyboardFlags: () => 0,
  } as unknown as GhosttyTerminalModelApi;
  const controller = new GhosttyInputController({
    model,
    input: input as unknown as HTMLTextAreaElement,
    pointerTarget: pointer as unknown as HTMLElement,
    cellSize: () => ({ width: 10, height: 20 }),
    isMac: true,
    onCopy: () => false,
    onData,
  });
  const wheel = () =>
    pointer.dispatchEvent(
      Object.assign(new Event("wheel", { cancelable: true }), {
        deltaY: 60,
        deltaMode: 0,
        clientX: 5,
        clientY: 5,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
      }),
    );
  /** Where the input element sits while composing: the anchor moved it onto the cursor. */
  const composeLeft = () => {
    input.dispatchEvent(new Event("compositionstart"));
    const left = input.style.left;
    input.dispatchEvent(
      Object.assign(new Event("compositionend"), { data: "" }),
    );
    return left;
  };
  return { controller, onData, wheel, composeLeft, loads };
}

describe("GhosttyInputController cold modules", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    vi.doUnmock("./TerminalMouse");
    vi.doUnmock("./ImeAnchor");
  });

  it("retries a failed load once and then reports the mouse", async () => {
    const { controller, onData, wheel, loads } = await controllerWith({
      mouse: 1,
    });
    await vi.waitFor(() => {
      onData.mockClear();
      wheel();
      expect(onData).toHaveBeenCalledTimes(1);
    });
    expect(loads.mouse).toBe(2);
    expect(warn).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("warns once when the retry fails too, and never throws", async () => {
    const { controller, onData, wheel, loads } = await controllerWith({
      mouse: 2,
    });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(() => wheel()).not.toThrow();
    expect(onData).not.toHaveBeenCalled();
    expect(loads.mouse).toBe(2);
    controller.dispose();
  });

  it("keeps the IME anchor when the mouse module never loads", async () => {
    const { controller, composeLeft } = await controllerWith({ mouse: 2 });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(composeLeft()).toBe("30px");
    controller.dispose();
  });

  it("keeps the mouse when the IME anchor module never loads", async () => {
    const { controller, onData, wheel, composeLeft } = await controllerWith({
      ime: 2,
    });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      onData.mockClear();
      wheel();
      expect(onData).toHaveBeenCalledTimes(1);
    });
    expect(composeLeft()).toBeUndefined();
    controller.dispose();
  });

  it("warns once per module that fails", async () => {
    const { controller } = await controllerWith({ mouse: 2, ime: 2 });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    expect(warn.mock.calls.map(([message]) => message).sort()).toEqual([
      "Terax: IME anchor failed to load",
      "Terax: mouse reporting failed to load",
    ]);
    controller.dispose();
  });

  it("neither retries nor warns once the controller is gone", async () => {
    const { controller, loads } = await controllerWith({ mouse: 2 });
    controller.dispose();
    await vi.waitFor(() => expect(loads.mouse).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(loads.mouse).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
