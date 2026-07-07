import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  readText: vi.fn<() => Promise<string>>(),
  writeText: vi.fn<(t: string) => Promise<void>>(),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => native);

const web = {
  readText: vi.fn<() => Promise<string>>(),
  writeText: vi.fn<(t: string) => Promise<void>>(),
};

const original = globalThis.navigator;
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";

function platform(userAgent: string) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent, clipboard: web },
  });
}

async function load() {
  vi.resetModules();
  return import("./terminalClipboard");
}

describe("terminalClipboard", () => {
  beforeEach(() => {
    native.readText.mockReset();
    native.writeText.mockReset();
    web.readText.mockReset();
    web.writeText.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: original,
    });
  });

  it("reads the native clipboard first on Linux", async () => {
    platform(LINUX);
    native.readText.mockResolvedValue("native");
    web.readText.mockResolvedValue("web");
    const { readTerminalClipboard } = await load();
    await expect(readTerminalClipboard()).resolves.toBe("native");
    expect(web.readText).not.toHaveBeenCalled();
  });

  it("falls back to the web clipboard when the native read fails", async () => {
    platform(LINUX);
    native.readText.mockRejectedValue(new Error("no ipc"));
    web.readText.mockResolvedValue("web");
    const { readTerminalClipboard } = await load();
    await expect(readTerminalClipboard()).resolves.toBe("web");
  });

  it("never touches the native clipboard off Linux", async () => {
    platform(MAC);
    web.readText.mockResolvedValue("web");
    const { readTerminalClipboard, writeTerminalClipboard } = await load();
    await expect(readTerminalClipboard()).resolves.toBe("web");
    await writeTerminalClipboard("x");
    expect(native.readText).not.toHaveBeenCalled();
    expect(native.writeText).not.toHaveBeenCalled();
    expect(web.writeText).toHaveBeenCalledWith("x");
  });

  it("writes the native clipboard first on Linux", async () => {
    platform(LINUX);
    native.writeText.mockResolvedValue();
    const { writeTerminalClipboard } = await load();
    await writeTerminalClipboard("copied");
    expect(native.writeText).toHaveBeenCalledWith("copied");
    expect(web.writeText).not.toHaveBeenCalled();
  });
});
