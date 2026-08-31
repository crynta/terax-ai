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

  it("keeps xterm WebGL as an explicit fallback", () => {
    const storage = createStorage();
    vi.stubGlobal("window", { localStorage: storage });
    setSelectedTerminalBackend("xterm-webgl");

    expect(selectedTerminalBackend()).toBe("xterm-webgl");
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

  it("falls back from WebGPU to Ghostty WebGL before xterm", () => {
    expect(
      resolveTerminalBackend("ghostty-webgpu", {
        webGpu: false,
        webGl2: true,
      }),
    ).toBe("ghostty-webgl");
    expect(
      resolveTerminalBackend("ghostty-webgpu", {
        webGpu: false,
        webGl2: false,
      }),
    ).toBe("xterm-webgl");
  });

  it("keeps an explicit xterm selection independent of GPU capability", () => {
    expect(
      resolveTerminalBackend("xterm-webgl", {
        webGpu: true,
        webGl2: true,
      }),
    ).toBe("xterm-webgl");
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
