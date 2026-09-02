import { beforeEach, describe, expect, it, vi } from "vitest";

const osPlugin = vi.hoisted(() => ({
  platform: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-os", () => ({ platform: osPlugin.platform }));

async function loadWith(platformValue: string) {
  vi.resetModules();
  osPlugin.platform.mockReturnValue(platformValue as never);
  return await import("./platform");
}

describe("platform detection", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("flags macOS and keeps native window controls there", async () => {
    const mod = await loadWith("macos");
    expect(mod.IS_MAC).toBe(true);
    expect(mod.IS_WINDOWS).toBe(false);
    expect(mod.IS_LINUX).toBe(false);
    expect(mod.USE_CUSTOM_WINDOW_CONTROLS).toBe(false);
  });

  it("renders custom window controls on windows and linux", async () => {
    const win = await loadWith("windows");
    expect(win.IS_WINDOWS).toBe(true);
    expect(win.USE_CUSTOM_WINDOW_CONTROLS).toBe(true);

    const linux = await loadWith("linux");
    expect(linux.IS_LINUX).toBe(true);
    expect(linux.USE_CUSTOM_WINDOW_CONTROLS).toBe(true);
  });

  it("treats an unknown platform as non-mac but without custom controls", async () => {
    const mod = await loadWith("");
    expect(mod.IS_MAC).toBe(false);
    expect(mod.USE_CUSTOM_WINDOW_CONTROLS).toBe(false);
  });

  it("uses meta for the primary modifier on mac and ctrl elsewhere", async () => {
    expect((await loadWith("macos")).MOD_PROP).toBe("meta");
    expect((await loadWith("windows")).MOD_PROP).toBe("ctrl");
  });

  it("joins shortcut parts without a separator on mac", async () => {
    const mac = await loadWith("macos");
    expect(mac.KEY_SEP).toBe("");
    expect(mac.fmtShortcut("Mod", "K")).toBe("ModK");

    const win = await loadWith("windows");
    expect(win.KEY_SEP).toBe("+");
    expect(win.fmtShortcut("Ctrl", "K")).toBe("Ctrl+K");
  });
});
