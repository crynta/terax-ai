import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultTerminalBackend,
  detectPlatform,
  resolveTerminalBackend,
  selectedTerminalBackend,
  setSelectedTerminalBackend,
  terminalRendererReport,
} from "./selection";

const STORAGE_KEY = "terax.experimental.terminal-backend";

describe("terminal backend selection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses Ghostty WebGPU by default", () => {
    expect(selectedTerminalBackend()).toBe("ghostty-webgpu");
  });

  it("ignores a retired backend preference", () => {
    const storage = createStorage();
    vi.stubGlobal("window", { localStorage: storage });
    storage.setItem(STORAGE_KEY, "xterm-webgl");

    expect(selectedTerminalBackend()).toBe("ghostty-webgpu");
    expect(storage.getItem(STORAGE_KEY)).toBe("xterm-webgl");
  });

  it("removes the override when restoring the default", () => {
    const storage = createStorage();
    vi.stubGlobal("window", { localStorage: storage });
    setSelectedTerminalBackend("ghostty-webgl");
    setSelectedTerminalBackend("ghostty-webgpu");

    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(selectedTerminalBackend()).toBe("ghostty-webgpu");
  });

  it("detects the platform from the user agent", () => {
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
      "windows",
    );
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64) WebKitGTK")).toBe(
      "linux",
    );
    expect(
      detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"),
    ).toBe("mac");
    expect(detectPlatform("")).toBe("other");
  });

  it("starts Windows on WebGL until WebGPU is selected, and everything else on WebGPU", () => {
    expect(defaultTerminalBackend("windows")).toBe("ghostty-webgl");
    for (const platform of ["mac", "linux", "other"] as const) {
      expect(defaultTerminalBackend(platform)).toBe("ghostty-webgpu");
    }
  });

  describe("on Windows", () => {
    const windows = {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/150",
      gpu: {},
    };

    it("uses WebGL by default and WebGPU only when explicitly stored", () => {
      const storage = createStorage();
      vi.stubGlobal("window", { localStorage: storage });
      vi.stubGlobal("navigator", windows);
      expect(selectedTerminalBackend()).toBe("ghostty-webgl");

      setSelectedTerminalBackend("ghostty-webgpu");
      expect(storage.getItem(STORAGE_KEY)).toBe("ghostty-webgpu");
      expect(selectedTerminalBackend()).toBe("ghostty-webgpu");

      setSelectedTerminalBackend("ghostty-webgl");
      expect(storage.getItem(STORAGE_KEY)).toBeNull();
      expect(selectedTerminalBackend()).toBe("ghostty-webgl");
    });

    it("reports which renderer new terminals use and why", () => {
      vi.stubGlobal("window", { localStorage: createStorage() });
      vi.stubGlobal("navigator", windows);
      expect(terminalRendererReport()).toEqual({
        platform: "windows",
        platformDefault: "ghostty-webgl",
        preferred: "ghostty-webgl",
        resolved: "ghostty-webgl",
        webGpuAvailable: true,
        reason: "platform default",
      });
      const storage = createStorage();
      storage.setItem(STORAGE_KEY, "ghostty-webgpu");
      vi.stubGlobal("window", { localStorage: storage });
      expect(terminalRendererReport()).toMatchObject({
        resolved: "ghostty-webgpu",
        reason: "explicit selection",
      });
      vi.stubGlobal("navigator", { userAgent: windows.userAgent });
      expect(terminalRendererReport()).toMatchObject({
        resolved: "ghostty-webgl",
        webGpuAvailable: false,
        reason: "WebGPU unavailable",
      });
    });
  });

  it("falls back to Ghostty WebGL and lets renderer errors remain visible", () => {
    expect(
      resolveTerminalBackend("ghostty-webgpu", {
        webGpu: false,
        webGl2: true,
        wasmSimd: true,
      }),
    ).toBe("ghostty-webgl");
    expect(
      resolveTerminalBackend("ghostty-webgpu", {
        webGpu: false,
        webGl2: false,
        wasmSimd: true,
      }),
    ).toBe("ghostty-webgl");
  });

  it("keeps Ghostty available through its scalar core when SIMD is unavailable", () => {
    expect(
      resolveTerminalBackend("ghostty-webgpu", {
        webGpu: true,
        webGl2: true,
        wasmSimd: false,
      }),
    ).toBe("ghostty-webgpu");
    expect(
      resolveTerminalBackend("ghostty-webgpu", {
        webGpu: false,
        webGl2: true,
        wasmSimd: false,
      }),
    ).toBe("ghostty-webgl");
  });
});

function createStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
