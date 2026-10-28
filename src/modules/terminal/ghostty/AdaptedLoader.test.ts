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

  describe("module caching and instances", () => {
    async function artifact() {
      return new Uint8Array(
        await readFile(
          new URL(
            "../../../../packages/ghostty-core/adapted/ghostty-vt.wasm",
            import.meta.url,
          ),
        ),
      );
    }

    async function loadWith(headers: Record<string, string>) {
      vi.resetModules();
      vi.spyOn(WebAssembly, "validate").mockReturnValue(true);
      const fetch = vi
        .fn()
        .mockImplementation(
          async () => new Response(await artifact(), { headers }),
        );
      vi.stubGlobal("fetch", fetch);
      const { TeraxGhostty } = await import("@terax/ghostty-core/adapted");
      return { fetch, ghostty: await TeraxGhostty.load() };
    }

    it("fetches and compiles once however many terminals follow", async () => {
      const { fetch, ghostty } = await loadWith({
        "Content-Type": "application/wasm",
      });
      const compile = vi.spyOn(WebAssembly, "compile");
      const streaming = vi.spyOn(WebAssembly, "compileStreaming");
      const terminals = Array.from({ length: 6 }, () =>
        ghostty.createTerminal(20, 4),
      );
      for (const terminal of terminals) terminal.dispose();

      expect(fetch).toHaveBeenCalledOnce();
      expect(compile).not.toHaveBeenCalled();
      expect(streaming).not.toHaveBeenCalled();
      expect(ghostty.memoryStats()).toMatchObject({
        instanceCount: 0,
        instancesCreated: 6,
      });
    });

    it("compiles the fetched bytes when the server omits the wasm content type", async () => {
      const { ghostty } = await loadWith({});
      const terminal = ghostty.createTerminal(40, 4);
      try {
        terminal.write(new TextEncoder().encode("fallback"));
        expect(terminal.updateRenderState().codepoints[0]).toBe(102);
      } finally {
        terminal.dispose();
      }
    });

    it("rejects an empty artifact and a module without the bridge exports", async () => {
      vi.resetModules();
      const { TeraxGhostty } = await import("@terax/ghostty-core/adapted");
      await expect(TeraxGhostty.loadBytes(new ArrayBuffer(0))).rejects.toThrow(
        "empty",
      );
      const bare = await WebAssembly.compile(
        Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0),
      );
      expect(() => TeraxGhostty.fromModule(bare)).toThrow(
        "Missing adapted Ghostty WASM export",
      );
    });

    it("gives each instance its own log import that stops reading memory once disposed", async () => {
      vi.resetModules();
      const { TeraxGhostty } = await import("@terax/ghostty-core/adapted");
      const module = await WebAssembly.compile(await artifact());
      const imports: WebAssembly.Imports[] = [];
      const log = vi.fn();
      const ghostty = TeraxGhostty.fromModule(module, {
        log,
        instantiate: (compiled, supplied) => {
          imports.push(supplied);
          return new WebAssembly.Instance(compiled, supplied);
        },
      });
      const first = ghostty.instantiate();
      const second = ghostty.instantiate();
      expect(imports).toHaveLength(2);
      expect(imports[0].env).not.toBe(imports[1].env);

      const write = (instance: typeof first, text: string, at: number) => {
        const bytes = new TextEncoder().encode(text);
        new Uint8Array(instance.exports.memory.buffer, at, bytes.length).set(
          bytes,
        );
        return bytes.length;
      };
      const emit = (index: number, at: number, length: number) =>
        (imports[index].env as { log: (p: number, n: number) => void }).log(
          at,
          length,
        );
      emit(0, 1024, write(first, "from first", 1024));
      emit(1, 2048, write(second, "from second", 2048));
      expect(log.mock.calls).toEqual([["from first"], ["from second"]]);

      first.dispose();
      emit(0, 1024, 10);
      expect(log).toHaveBeenCalledTimes(2);
      second.dispose();
    });
  });
});
