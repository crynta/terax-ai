import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Ghostty artifact selection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([true, false])(
    "loads a compatible artifact with SIMD=%s",
    async (simd) => {
      vi.resetModules();
      vi.spyOn(WebAssembly, "validate").mockReturnValue(simd);
      const filename = simd ? "ghostty-vt.wasm" : "ghostty-vt-scalar.wasm";
      const file = await readFile(
        new URL(
          `../../../../packages/ghostty-core/adapted/${filename}`,
          import.meta.url,
        ),
      );
      const fetch = vi.fn().mockResolvedValue(
        new Response(Uint8Array.from(file), {
          headers: { "Content-Type": "application/wasm" },
        }),
      );
      vi.stubGlobal("fetch", fetch);
      const { TeraxGhostty } = await import("@terax/ghostty-core/adapted");
      const ghostty = await TeraxGhostty.load();
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining(filename),
      );
      const terminal = ghostty.createTerminal(40, 4);
      try {
        terminal.write(new TextEncoder().encode("\x1b[31mcompatible\x1b[0m"));
        expect(terminal.updateRenderState().codepoints[0]).toBe(99);
      } finally {
        terminal.dispose();
      }
    },
  );
});
