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
  it("serializes native copies and reads after the latest preceding copy", async () => {
    let finishFirst = () => {};
    let contents = "old";
    native.writeText.mockImplementationOnce(
      (text) =>
        new Promise<void>((resolve) => {
          finishFirst = () => {
            contents = text;
            resolve();
          };
        }),
    );
    native.writeText.mockImplementation(async (text) => {
      contents = text;
    });
    native.readText.mockImplementation(async () => contents);
    const first = writeTerminalClipboard("first");
    await vi.waitFor(() => expect(native.writeText).toHaveBeenCalledOnce());
    const second = writeTerminalClipboard("second");
    const paste = readTerminalClipboard();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const writesBeforeFirstFinished = native.writeText.mock.calls.length;
    const readsBeforeFirstFinished = native.readText.mock.calls.length;
    finishFirst();
    await Promise.all([first, second]);
    await expect(paste).resolves.toBe("second");
    expect(writesBeforeFirstFinished).toBe(1);
    expect(readsBeforeFirstFinished).toBe(0);
    expect(native.writeText.mock.calls).toEqual([["first"], ["second"]]);
  });

  it("does not read old text after a pending native write fails and can retry", async () => {
    native.writeText.mockRejectedValueOnce(new Error("clipboard busy"));
    const copy = writeTerminalClipboard("failed");
    const paste = readTerminalClipboard();
    await expect(copy).rejects.toThrow("clipboard busy");
    await expect(paste).resolves.toBe("");
    expect(native.readText).not.toHaveBeenCalled();
    native.writeText.mockResolvedValueOnce(undefined);
    native.readText.mockResolvedValueOnce("retry");
    await writeTerminalClipboard("retry");
    await expect(readTerminalClipboard()).resolves.toBe("retry");
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
    await expect(readTerminalClipboard()).resolves.toBe("");
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
});
