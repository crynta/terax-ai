import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeElement, FakeTextArea } from "./fakeTextArea";

/** A controller whose mouse module fails to load `failures` times. */
async function controllerWithMouse(failures: number) {
  const loads = { count: 0 };
  vi.resetModules();
  vi.doMock("./TerminalMouse", async (importOriginal) => {
    loads.count++;
    if (loads.count <= failures) throw new Error("chunk failed");
    return importOriginal();
  });
  const { GhosttyInputController } = await import("./GhosttyInputController");
  const pointer = new FakeElement();
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
      x: 0,
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
    input: new FakeTextArea() as unknown as HTMLTextAreaElement,
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
  return { controller, onData, wheel, loads };
}

describe("GhosttyInputController cold modules", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    vi.doUnmock("./TerminalMouse");
  });

  it("retries a failed load once and then reports the mouse", async () => {
    const { controller, onData, wheel, loads } = await controllerWithMouse(1);
    await vi.waitFor(() => {
      onData.mockClear();
      wheel();
      expect(onData).toHaveBeenCalledTimes(1);
    });
    expect(loads.count).toBe(2);
    expect(warn).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("warns once when the retry fails too, and never throws", async () => {
    const { controller, onData, wheel, loads } = await controllerWithMouse(2);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(() => wheel()).not.toThrow();
    expect(onData).not.toHaveBeenCalled();
    expect(loads.count).toBe(2);
    controller.dispose();
  });

  it("neither retries nor warns once the controller is gone", async () => {
    const { controller, loads } = await controllerWithMouse(2);
    controller.dispose();
    await vi.waitFor(() => expect(loads.count).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(loads.count).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
