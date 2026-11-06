import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectPlatform,
  resolveTerminalBackend,
  selectedTerminalBackend,
  setSelectedTerminalBackend,
  terminalBackendFor,
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

  describe("renderer setting", () => {
    const gpu = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", gpu: {} };
    const noGpu = { userAgent: gpu.userAgent };

    it("defaults Windows to WebGL while preserving explicit choices on every platform", () => {
      for (const [userAgent, automatic] of [
        ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "ghostty-webgl"],
        ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "ghostty-webgpu"],
        ["Mozilla/5.0 (X11; Linux x86_64)", "ghostty-webgpu"],
        ["", "ghostty-webgpu"],
      ] as const) {
        vi.stubGlobal("navigator", { userAgent, gpu: {} });
        vi.stubGlobal("window", { localStorage: createStorage() });
        expect(selectedTerminalBackend(), userAgent).toBe(automatic);
        expect(terminalBackendFor("auto"), userAgent).toBe(automatic);
        expect(terminalBackendFor("webgpu"), userAgent).toBe("ghostty-webgpu");
        expect(terminalBackendFor("webgl"), userAgent).toBe("ghostty-webgl");
      }
    });

    it("falls back to WebGL where the webview has no WebGPU, whatever was chosen", () => {
      vi.stubGlobal("navigator", noGpu);
      vi.stubGlobal("window", { localStorage: createStorage() });
      for (const setting of ["auto", "webgpu", "webgl"] as const) {
        expect(terminalBackendFor(setting), setting).toBe("ghostty-webgl");
      }
    });

    it("lets the experimental override steer Automatic but not an explicit choice", () => {
      const storage = createStorage();
      storage.setItem(STORAGE_KEY, "ghostty-webgl");
      vi.stubGlobal("navigator", gpu);
      vi.stubGlobal("window", { localStorage: storage });
      expect(terminalBackendFor("auto")).toBe("ghostty-webgl");
      expect(terminalBackendFor("webgpu")).toBe("ghostty-webgpu");
    });

    it("persists an experimental WebGPU opt-in on Windows and clears it for the platform default", () => {
      const storage = createStorage();
      vi.stubGlobal("navigator", gpu);
      vi.stubGlobal("window", { localStorage: storage });
      setSelectedTerminalBackend("ghostty-webgpu");
      expect(storage.getItem(STORAGE_KEY)).toBe("ghostty-webgpu");
      expect(terminalBackendFor("auto")).toBe("ghostty-webgpu");
      expect(terminalBackendFor("webgl")).toBe("ghostty-webgl");
      setSelectedTerminalBackend("ghostty-webgl");
      expect(storage.getItem(STORAGE_KEY)).toBeNull();
      expect(terminalBackendFor("auto")).toBe("ghostty-webgl");
    });

    it("keeps the Windows default when storage is unavailable or has a retired preference", () => {
      vi.stubGlobal("navigator", gpu);
      vi.stubGlobal("window", undefined);
      expect(terminalBackendFor("auto")).toBe("ghostty-webgl");
      const storage = createStorage();
      storage.setItem(STORAGE_KEY, "xterm-webgl");
      vi.stubGlobal("window", { localStorage: storage });
      expect(terminalBackendFor("auto")).toBe("ghostty-webgl");
      vi.stubGlobal("window", {
        get localStorage() {
          throw new Error("Storage disabled");
        },
      });
      expect(terminalBackendFor("auto")).toBe("ghostty-webgl");
    });

    it("reports which renderer new terminals use and why", () => {
      vi.stubGlobal("navigator", gpu);
      vi.stubGlobal("window", { localStorage: createStorage() });
      expect(terminalRendererReport()).toEqual({
        platform: "windows",
        setting: "auto",
        preferred: "ghostty-webgl",
        resolved: "ghostty-webgl",
        webGpuAvailable: true,
        reason: "automatic",
      });
      expect(terminalRendererReport("webgpu")).toMatchObject({
        setting: "webgpu",
        preferred: "ghostty-webgpu",
        resolved: "ghostty-webgpu",
        reason: "settings",
      });
      expect(terminalRendererReport("webgl")).toMatchObject({
        setting: "webgl",
        resolved: "ghostty-webgl",
        reason: "settings",
      });
      vi.stubGlobal("navigator", noGpu);
      expect(terminalRendererReport("webgpu")).toMatchObject({
        preferred: "ghostty-webgpu",
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
