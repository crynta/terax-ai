import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativeClipboard = vi.hoisted(() => ({
  readText: vi.fn<() => Promise<string>>(),
  writeText: vi.fn<(text: string) => Promise<void>>(),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => nativeClipboard);

import {
  readTerminalClipboard,
  writeTerminalClipboard,
} from "./terminalClipboard";

const originalNavigator = globalThis.navigator;

const webClipboard = {
  readText: vi.fn<() => Promise<string>>(),
  writeText: vi.fn<(text: string) => Promise<void>>(),
};

describe("terminalClipboard", () => {
  beforeEach(() => {
    nativeClipboard.readText.mockReset();
    nativeClipboard.writeText.mockReset();
    webClipboard.readText.mockReset();
    webClipboard.writeText.mockReset();

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: webClipboard },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
  });

  it("reads from the native clipboard before falling back to the web clipboard", async () => {
    nativeClipboard.readText.mockResolvedValue("from native");
    webClipboard.readText.mockResolvedValue("from web");

    await expect(readTerminalClipboard()).resolves.toBe("from native");

    expect(nativeClipboard.readText).toHaveBeenCalledOnce();
    expect(webClipboard.readText).not.toHaveBeenCalled();
  });

  it("falls back to the web clipboard when native clipboard read fails", async () => {
    nativeClipboard.readText.mockRejectedValue(new Error("not available"));
    webClipboard.readText.mockResolvedValue("from web");

    await expect(readTerminalClipboard()).resolves.toBe("from web");

    expect(nativeClipboard.readText).toHaveBeenCalledOnce();
    expect(webClipboard.readText).toHaveBeenCalledOnce();
  });

  it("writes to the native clipboard before falling back to the web clipboard", async () => {
    nativeClipboard.writeText.mockResolvedValue();

    await writeTerminalClipboard("copy me");

    expect(nativeClipboard.writeText).toHaveBeenCalledWith("copy me");
    expect(webClipboard.writeText).not.toHaveBeenCalled();
  });

  it("falls back to the web clipboard when native clipboard write fails", async () => {
    nativeClipboard.writeText.mockRejectedValue(new Error("not available"));
    webClipboard.writeText.mockResolvedValue();

    await writeTerminalClipboard("copy me");

    expect(nativeClipboard.writeText).toHaveBeenCalledWith("copy me");
    expect(webClipboard.writeText).toHaveBeenCalledWith("copy me");
  });
});
