import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readTerminalClipboard,
  writeTerminalClipboard,
} from "./terminalClipboard";

const native = vi.hoisted(() => ({
  readText: vi.fn<() => Promise<string>>(),
  writeText: vi.fn<(text: string) => Promise<void>>(),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => native);
const web = { readText: vi.fn(), writeText: vi.fn() };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("isTauri", true);
  vi.stubGlobal("navigator", { clipboard: web });
});
afterEach(() => vi.unstubAllGlobals());

describe("terminal clipboard", () => {
  it("waits for an immediately preceding copy before reading for paste", async () => {
    let complete = () => {};
    native.writeText.mockReturnValue(
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    );
    native.readText.mockResolvedValue("new selection");
    const copied = writeTerminalClipboard("new selection");
    const pasted = readTerminalClipboard();
    await Promise.resolve();
    expect(native.readText).not.toHaveBeenCalled();
    complete();
    await copied;
    await expect(pasted).resolves.toBe("new selection");
  });

  it("does not paste stale contents after the preceding copy failed", async () => {
    native.writeText.mockRejectedValue(new Error("clipboard busy"));
    const copied = writeTerminalClipboard("new selection");
    const pasted = readTerminalClipboard();
    await expect(copied).rejects.toThrow("clipboard busy");
    await expect(pasted).rejects.toThrow("clipboard busy");
    expect(native.readText).not.toHaveBeenCalled();
    native.readText.mockResolvedValue("external selection");
    await expect(readTerminalClipboard()).resolves.toBe("external selection");
  });

  it("keeps successive clipboard writes in invocation order", async () => {
    let complete = () => {};
    native.writeText.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    native.writeText.mockResolvedValueOnce(undefined);
    const first = writeTerminalClipboard("first");
    const second = writeTerminalClipboard("second");
    await vi.waitFor(() => expect(native.writeText).toHaveBeenCalledOnce());
    complete();
    await Promise.all([first, second]);
    expect(native.writeText.mock.calls).toEqual([["first"], ["second"]]);
  });

  it.each(["Macintosh", "Windows NT", "X11; Linux"])(
    "uses native copy and paste in the %s application without WebKit prompts",
    async (userAgent) => {
      vi.stubGlobal("navigator", { userAgent, clipboard: web });
      native.readText.mockResolvedValue("external copy");
      await expect(readTerminalClipboard()).resolves.toBe("external copy");
      await writeTerminalClipboard("terminal selection");
      expect(native.writeText).toHaveBeenCalledWith("terminal selection");
      expect(web.readText).not.toHaveBeenCalled();
      expect(web.writeText).not.toHaveBeenCalled();
    },
  );

  it("does not fall back to permission-gated web reads after an IPC failure", async () => {
    native.readText.mockRejectedValue(new Error("clipboard busy"));
    await expect(readTerminalClipboard()).rejects.toThrow("clipboard busy");
    expect(web.readText).not.toHaveBeenCalled();
    native.readText.mockResolvedValue("retry");
    await expect(readTerminalClipboard()).resolves.toBe("retry");
  });

  it("reports failed copies instead of signaling success", async () => {
    native.writeText.mockRejectedValue(new Error("clipboard busy"));
    await expect(writeTerminalClipboard("text")).rejects.toThrow(
      "clipboard busy",
    );
    expect(web.writeText).not.toHaveBeenCalled();
  });

  it("uses browser clipboard APIs in a browser preview", async () => {
    vi.stubGlobal("isTauri", false);
    web.readText.mockResolvedValue("web");
    await expect(readTerminalClipboard()).resolves.toBe("web");
    await writeTerminalClipboard("preview");
    expect(web.writeText).toHaveBeenCalledWith("preview");
    expect(native.readText).not.toHaveBeenCalled();
    expect(native.writeText).not.toHaveBeenCalled();
  });

  it("rejects unavailable browser clipboard access", async () => {
    vi.stubGlobal("isTauri", false);
    vi.stubGlobal("navigator", {});
    await expect(readTerminalClipboard()).rejects.toThrow(
      "Clipboard is unavailable",
    );
    await expect(writeTerminalClipboard("text")).rejects.toThrow(
      "Clipboard is unavailable",
    );
  });
});
