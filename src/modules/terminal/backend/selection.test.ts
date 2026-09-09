import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveTerminalBackend,
  selectedTerminalBackend,
  setSelectedTerminalBackend,
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
