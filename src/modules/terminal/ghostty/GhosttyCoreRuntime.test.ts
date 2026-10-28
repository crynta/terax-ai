import { readFile } from "node:fs/promises";
import v8 from "node:v8";
import vm from "node:vm";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PackedCellView } from "./core/packedCells";
import { GhosttyCoreRuntime } from "./GhosttyCoreRuntime";

let wasmBytes: ArrayBuffer;
let wasmModule: WebAssembly.Module;

v8.setFlagsFromString("--expose-gc");
const collectGarbage = vm.runInNewContext("gc") as () => void;

type Weak = { deref(): object | undefined };
const weak = (target: object): Weak =>
  new (
    globalThis as unknown as { WeakRef: new (target: object) => Weak }
  ).WeakRef(target);

async function collected(ref: Weak): Promise<boolean> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    collectGarbage();
    if (ref.deref() === undefined) return true;
  }
  return false;
}

beforeAll(async () => {
  const path = new URL(
    "../../../../packages/ghostty-core/adapted/ghostty-vt.wasm",
    import.meta.url,
  );
  const file = await readFile(path);
  wasmBytes = Uint8Array.from(file).buffer;
  wasmModule = await WebAssembly.compile(wasmBytes.slice(0));
});

describe("GhosttyCoreRuntime", () => {
  it.each(["release", "compact", "dispose"] as const)(
    "invalidates borrowed cells when presentation storage is freed by %s",
    async (operation) => {
      const runtime = new GhosttyCoreRuntime(() =>
        TeraxGhostty.loadBytes(wasmBytes),
      );
      try {
        const model = await runtime.createModel({
          leafId: 99,
          cols: 80,
          rows: 24,
        });
        model.write(new TextEncoder().encode("retained output"));
        const cells = model.renderCells();
        expect(cells.codepoint(0)).toBe("r".codePointAt(0));
        if (operation === "release") model.releasePresentationResources();
        else if (operation === "compact") model.compactPresentationResources();
        else model.dispose();
        expect(() => cells.codepoint(0)).toThrow(
          "render cells are unavailable",
        );
        if (operation !== "dispose") {
          expect(model.renderCells().codepoint(0)).toBe("r".codePointAt(0));
          expect(model.readText(24)).toBe("retained output");
        }
      } finally {
        runtime.dispose();
      }
    },
  );

  it("releases the compiled module of a preload that never becomes a terminal", async () => {
    vi.useFakeTimers();
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes),
    );
    try {
      await runtime.preload();
      expect(runtime.diagnostics()).toMatchObject({
        idleReleaseScheduled: true,
        wasmModuleCached: true,
        wasmMemoryBytes: 0,
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(runtime.diagnostics().wasmModuleCached).toBe(false);
      const model = await runtime.createModel({
        leafId: 1,
        cols: 120,
        rows: 40,
      });
      model.write(new TextEncoder().encode("output\r\n".repeat(10_000)));
      expect(runtime.diagnostics().wasmMemoryBytes).toBeGreaterThan(0);
      model.dispose();
      expect(runtime.diagnostics().wasmMemoryBytes).toBe(0);
      await vi.advanceTimersByTimeAsync(30_000);
      await runtime.preload();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(runtime.diagnostics()).toMatchObject({
        status: "cold",
        wasmMemoryBytes: 0,
        wasmModuleCached: false,
        idleReleaseScheduled: false,
      });
    } finally {
      runtime.dispose();
      vi.useRealTimers();
    }
  });

  it("does not retain a late WASM load or create a model after disposal", async () => {
    const core = await TeraxGhostty.loadBytes(wasmBytes);
    const createTerminal = vi.spyOn(core, "createTerminal");
    let deliver = (_core: TeraxGhostty) => {};
    const runtime = new GhosttyCoreRuntime(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const pending = runtime.createModel({ leafId: 2, cols: 80, rows: 24 });
    const rejection = expect(pending).rejects.toThrow("disposed");
    await Promise.resolve();
    runtime.dispose();
    deliver(core);
    await rejection;
    expect(createTerminal).not.toHaveBeenCalled();
    expect(runtime.diagnostics()).toMatchObject({
      status: "cold",
      modelCount: 0,
      pendingModelCount: 0,
      wasmMemoryBytes: 0,
      idleReleaseScheduled: false,
    });
    await expect(runtime.preload()).rejects.toThrow("disposed");
  });

  it("skips a load cancelled before it starts and retries a synchronous loader failure", async () => {
    const loader = vi.fn(() => TeraxGhostty.loadBytes(wasmBytes));
    const abandoned = new GhosttyCoreRuntime(loader);
    const loading = abandoned.preload();
    abandoned.dispose();
    await expect(loading).rejects.toThrow("disposed");
    expect(loader).not.toHaveBeenCalled();
    loader.mockImplementationOnce(() => {
      throw new Error("load failed");
    });
    const runtime = new GhosttyCoreRuntime(loader);
    try {
      await expect(runtime.preload()).rejects.toThrow("load failed");
      expect(runtime.diagnostics().status).toBe("failed");
      await runtime.preload();
      expect(runtime.diagnostics().status).toBe("ready");
    } finally {
      runtime.dispose();
    }
  });

  it("releases a native terminal when its initial configuration fails", async () => {
    const core = await TeraxGhostty.loadBytes(wasmBytes);
    const runtime = new GhosttyCoreRuntime(() => Promise.resolve(core));
    try {
      await runtime.preload();
      const native = core.createTerminal(80, 24);
      const dispose = vi.spyOn(native, "dispose");
      vi.spyOn(native, "setPalette").mockImplementationOnce(() => {
        throw new Error("palette allocation failed");
      });
      vi.spyOn(core, "createTerminal").mockReturnValueOnce(native);
      await expect(
        runtime.createModel({
          leafId: 3,
          cols: 80,
          rows: 24,
          config: { palette: [0xffffff] },
        }),
      ).rejects.toThrow("palette allocation failed");
      expect(dispose).toHaveBeenCalledOnce();
      expect(runtime.diagnostics()).toMatchObject({
        modelCount: 0,
        pendingModelCount: 0,
        idleReleaseScheduled: true,
      });
      const retry = await runtime.createModel({
        leafId: 3,
        cols: 80,
        rows: 24,
      });
      expect(retry.cols).toBe(80);
    } finally {
      runtime.dispose();
    }
  });

  it("loads one WASM runtime for concurrent terminal models", async () => {
    const loader = vi.fn(() => TeraxGhostty.loadBytes(wasmBytes.slice(0)));
    const runtime = new GhosttyCoreRuntime(loader);
    const [first, second] = await Promise.all([
      runtime.createModel({ leafId: 1, cols: 80, rows: 24 }),
      runtime.createModel({ leafId: 2, cols: 120, rows: 40 }),
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(runtime.diagnostics()).toMatchObject({
      status: "ready",
      modelCount: 2,
      pendingModelCount: 0,
    });
    expect(runtime.diagnostics().wasmMemoryBytes).toBeGreaterThan(0);

    first.dispose();
    expect(runtime.diagnostics().modelCount).toBe(1);
    runtime.disposeAllModels();
    expect(runtime.diagnostics().modelCount).toBe(0);
    second.dispose();
  });

  it("returns a closed terminal's memory at once and releases the idle compiled module", async () => {
    vi.useFakeTimers();
    try {
      const loader = vi.fn(() => TeraxGhostty.loadBytes(wasmBytes.slice(0)));
      const runtime = new GhosttyCoreRuntime(loader);
      const first = await runtime.createModel({
        leafId: 101,
        cols: 80,
        rows: 24,
      });

      expect(runtime.diagnostics().wasmMemoryBytes).toBeGreaterThan(0);
      first.dispose();
      expect(runtime.diagnostics().wasmMemoryBytes).toBe(0);
      expect(runtime.diagnostics().idleReleaseScheduled).toBe(true);

      await vi.advanceTimersByTimeAsync(30_000);
      const second = await runtime.createModel({
        leafId: 102,
        cols: 80,
        rows: 24,
      });
      expect(loader).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(runtime.diagnostics()).toMatchObject({
        status: "ready",
        modelCount: 1,
        idleReleaseScheduled: false,
      });

      second.dispose();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(runtime.diagnostics()).toMatchObject({
        status: "cold",
        wasmMemoryBytes: 0,
        idleReleaseScheduled: false,
      });

      const third = await runtime.createModel({
        leafId: 103,
        cols: 80,
        rows: 24,
      });
      expect(loader).toHaveBeenCalledTimes(2);
      third.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps parsing while no rendering surface is attached", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const damage = vi.fn();
    const model = await runtime.createModel({
      leafId: 7,
      cols: 20,
      rows: 4,
    });
    model.consumeDamage();
    model.subscribeDamage(damage);

    model.write(new TextEncoder().encode("hidden output"));

    expect(damage).toHaveBeenCalledTimes(1);
    expect(model.readText(4)).toContain("hidden output");
    expect(model.consumeDamage().kind).not.toBe("none");
    expect(model.consumeDamage()).toEqual({ kind: "none" });
    model.dispose();
  });

  it("keeps renderer identity out of the shared Ghostty model runtime", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 16,
      backend: "ghostty-webgl",
      cols: 80,
      rows: 24,
    });

    expect(model.backend).toBe("ghostty-webgl");
    expect(model.diagnostics().backend).toBe("ghostty-webgl");
    expect(runtime.diagnostics().modelCount).toBe(1);
    model.dispose();
  });

  it("coalesces high-frequency PTY chunks into one render-state update", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 8,
      cols: 80,
      rows: 24,
    });
    model.consumeDamage();
    const warmUpdates = model.diagnostics().renderStateUpdates ?? 0;
    const damage = vi.fn();
    model.subscribeDamage(damage);

    for (let index = 0; index < 100; index += 1) {
      model.write(new TextEncoder().encode(`${index}\r\n`));
    }

    expect(damage).toHaveBeenCalledTimes(1);
    expect(model.diagnostics()).toMatchObject({
      writes: 100,
      renderStateUpdates: warmUpdates,
    });
    expect(model.consumeDamage().kind).not.toBe("none");
    expect(model.diagnostics().renderStateUpdates).toBe(warmUpdates + 1);
    expect(model.consumeDamage()).toEqual({ kind: "none" });
    expect(model.diagnostics().renderStateUpdates).toBe(warmUpdates + 1);
    model.dispose();
  });

  it("reuses mode snapshots until terminal modes actually change", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 81,
      cols: 80,
      rows: 24,
    });

    const initial = model.modes();
    expect(model.modes()).toBe(initial);
    model.write(new TextEncoder().encode("ordinary output"));
    expect(model.modes()).toBe(initial);

    model.write(new TextEncoder().encode("\x1b[?2004h"));
    const bracketedPaste = model.modes();
    expect(bracketedPaste).not.toBe(initial);
    expect(bracketedPaste.bracketedPaste).toBe(true);
    expect(model.modes()).toBe(bracketedPaste);
    model.dispose();
  });

  it("exposes current modes during semantic callbacks in the same write", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const states: boolean[] = [];
    const model = await runtime.createModel({
      leafId: 82,
      cols: 80,
      rows: 24,
      onEvent: () => states.push(model.modes().bracketedPaste),
    });
    try {
      model.write(new TextEncoder().encode("\x1b[?2004h\x1b]2;title\x07"));
      model.write(new TextEncoder().encode("\x1b[?2004l\x1b]2;title\x07"));
      expect(states).toEqual([true, false]);
    } finally {
      runtime.dispose();
    }
  });

  it("presents an OSC 133 wrapped Starship prompt atomically", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 18,
      cols: 80,
      rows: 24,
    });
    model.consumeDamage();
    const damage = vi.fn();
    model.subscribeDamage(damage);

    model.write(new TextEncoder().encode("previous output\r\n"));
    expect(damage).toHaveBeenCalledTimes(1);
    model.write(new TextEncoder().encode("\x1b]133;A\x1b\\partial"));
    expect(model.presentationSuppressed()).toBe(true);
    expect(model.deferPresentation()).toBe(true);
    damage.mockClear();

    model.write(new TextEncoder().encode(" prompt\x1b]133;B\x1b\\"));
    expect(damage).toHaveBeenCalledTimes(1);
    expect(model.presentationSuppressed()).toBe(false);
    expect(model.consumeDamage().kind).not.toBe("none");
    expect(model.readText(24)).toContain("partial prompt");
    model.dispose();
  });

  it("holds synchronized output until reset with a bounded watchdog", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 17,
      cols: 80,
      rows: 24,
    });
    model.consumeDamage();
    const damage = vi.fn();
    model.subscribeDamage(damage);
    vi.useFakeTimers();

    try {
      model.write(new TextEncoder().encode("\x1b[?2026hfirst"));
      expect(damage).not.toHaveBeenCalled();
      expect(model.presentationSuppressed()).toBe(true);
      expect(model.deferPresentation()).toBe(true);

      await vi.advanceTimersByTimeAsync(999);
      expect(damage).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(damage).toHaveBeenCalledTimes(1);
      expect(model.presentationSuppressed()).toBe(false);
      expect(model.consumeDamage().kind).not.toBe("none");

      damage.mockClear();
      model.write(new TextEncoder().encode("second"));
      expect(damage).not.toHaveBeenCalled();
      expect(model.deferPresentation()).toBe(true);

      model.write(new TextEncoder().encode("\x1b[?2026l"));
      expect(damage).toHaveBeenCalledTimes(1);
      expect(model.presentationSuppressed()).toBe(false);
      expect(model.consumeDamage().kind).not.toBe("none");
    } finally {
      model.dispose();
      vi.useRealTimers();
    }
  });

  it("does not present Fish's partial synchronized repaint from a queued resize frame", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 19,
      cols: 80,
      rows: 24,
    });
    const encode = (value: string) => new TextEncoder().encode(value);
    model.write(encode("~/terax > "));
    model.consumeDamage();
    const damage = vi.fn();
    model.subscribeDamage(damage);

    model.resize(100, 24);
    expect(damage).toHaveBeenCalledTimes(1);

    model.write(encode("\x1b[?2026h\r\x1b[2K"));
    expect(model.readText(24)).not.toContain("~/terax >");
    expect(model.deferPresentation()).toBe(true);

    damage.mockClear();
    model.write(encode("~/terax > \x1b[?2026l"));
    expect(model.presentationSuppressed()).toBe(false);
    expect(damage).toHaveBeenCalledTimes(1);
    expect(model.consumeDamage().kind).not.toBe("none");
    expect(model.readText(24)).toContain("~/terax >");
    model.dispose();
  });

  it("keeps a bottom-anchored Fish Starship prompt complete during local reflow", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 20,
      cols: 120,
      rows: 30,
    });
    const prompt =
      "\x1b[J" +
      "\x1b[1;36mterax-ghostty\x1b[0m on " +
      "\x1b[1;35m feat/ghostty-webgpu-terminal\x1b[0m " +
      "\x1b[1;31m[!?]\x1b[0m via \x1b[1;32m v26.5.0\x1b[0m\r\n" +
      "\x1b[1;32m❯\x1b[0m ";
    model.write(
      new TextEncoder().encode(
        `${Array.from({ length: 40 }, (_, index) => `line-${index}\r\n`).join("")}${prompt}`,
      ),
    );
    expect(model.readText(30)).toContain("terax-ghostty");
    expect(model.readText(30)).toContain("❯");

    for (const cols of [119, 105, 90, 72, 55, 40, 55, 72, 88, 104, 120]) {
      model.resize(cols, 30);
      model.consumeDamage();
      expect(model.readText(30)).toContain("terax-ghostty");
      expect(model.readText(30)).toContain("❯");
      expect(model.cursor().y).toBe(29);
    }
    model.dispose();
  });

  it("drains terminal replies as bytes in protocol order", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const replies: Uint8Array[] = [];
    const model = await runtime.createModel({
      leafId: 9,
      cols: 80,
      rows: 24,
      onReply: (bytes) => replies.push(bytes),
    });

    model.write(new TextEncoder().encode("\x1b[c\x1b[5n\x1b[>c\x1b[6n"));

    expect(new TextDecoder().decode(concat(replies))).toBe(
      "\x1b[?62;22;52c\x1b[0n\x1b[>1;10;0c\x1b[1;1R",
    );
    expect(runtime.diagnostics().nativeDeviceAttributes).toBe(true);
    model.dispose();
  });

  it("renders a bounded scrollback viewport and returns to the live screen", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 10,
      cols: 10,
      rows: 3,
      config: { scrollbackLimit: 100 },
    });
    model.consumeDamage();
    model.write(new TextEncoder().encode("one\r\ntwo\r\nthree\r\nfour"));

    const livePosition = model.scrollPosition();
    expect(livePosition).toEqual({ offset: 0, history: 1 });
    expect(model.scrollPosition()).toBe(livePosition);
    expect(readViewportRows(model)).toEqual(["two", "three", "four"]);

    expect(model.scrollBy(-1)).toBe(true);
    const historyPosition = model.scrollPosition();
    expect(historyPosition).not.toBe(livePosition);
    expect(historyPosition).toEqual({ offset: 1, history: 1 });
    expect(model.scrollPosition()).toBe(historyPosition);
    expect(readViewportRows(model)).toEqual(["one", "two", "three"]);
    expect(model.cursor().visible).toBe(false);

    expect(model.scrollToBottom()).toBe(true);
    expect(readViewportRows(model)).toEqual(["two", "three", "four"]);
    model.dispose();
  });

  it("extracts linear and rectangular selections from scrollback", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 13,
      cols: 10,
      rows: 3,
      config: { scrollbackLimit: 100 },
    });
    model.write(new TextEncoder().encode("one\r\ntwo  words\r\nthree\r\nfour"));

    expect(
      model.selectionText({
        anchor: { line: 0, column: 1 },
        focus: { line: 2, column: 2 },
        rectangular: false,
      }),
    ).toBe("ne\ntwo  words\nthr");
    expect(
      model.selectionText({
        anchor: { line: 0, column: 0 },
        focus: { line: 2, column: 2 },
        rectangular: true,
      }),
    ).toBe("one\ntwo\nthr");
    expect(model.wordRangeAt({ line: 1, column: 6 })).toEqual({
      start: 5,
      end: 9,
    });
    model.dispose();
  });

  it("copies soft-wrapped rows as one logical line", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 14,
      cols: 5,
      rows: 3,
    });
    model.write(new TextEncoder().encode("abcdefghij"));

    expect(
      model.selectionText({
        anchor: { line: 0, column: 0 },
        focus: { line: 1, column: 4 },
        rectangular: false,
      }),
    ).toBe("abcdefghij");
    model.dispose();
  });

  it("clears history while preserving the active cursor line", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 16,
      cols: 12,
      rows: 3,
    });
    model.write(new TextEncoder().encode("old one\r\nold two\r\nprompt"));

    model.clear();

    expect(model.scrollPosition()).toEqual({ offset: 0, history: 0 });
    expect(readViewportRows(model)).toEqual(["prompt", "", ""]);
    expect(model.cursor()).toEqual(expect.objectContaining({ x: 6, y: 0 }));
    model.clear();
    expect(readViewportRows(model)).toEqual(["prompt", "", ""]);
    model.dispose();
  });

  it("maps OSC 8 links through the visible viewport", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 15,
      cols: 20,
      rows: 3,
    });
    const uri = "https://terax.dev/docs";
    model.write(
      new TextEncoder().encode(`\x1b]8;;${uri}\x1b\\Terax\x1b]8;;\x1b\\ plain`),
    );

    expect(model.hyperlinkAtViewportCell(0, 0)).toBe(uri);
    expect(model.hyperlinkAtViewportCell(0, 4)).toBe(uri);
    expect(model.hyperlinkAtViewportCell(0, 6)).toBeNull();
    expect(model.hyperlinkAtViewportCell(-1, 0)).toBeNull();
    model.dispose();
  });

  it("finds plain URLs across wrapped rows without linking trailing blank cells", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({ leafId: 31, cols: 16, rows: 4 });
    model.write(
      new TextEncoder().encode("日本 https://example.com/docs\r\nblank"),
    );
    expect(model.hyperlinkAtViewportCell(0, 5)).toBe(
      "https://example.com/docs",
    );
    expect(model.hyperlinkAtViewportCell(1, 3)).toBe(
      "https://example.com/docs",
    );
    expect(model.hyperlinkAtViewportCell(1, 15)).toBeNull();
    model.write(new TextEncoder().encode("\x1bc"));
    expect(model.hyperlinkAtViewportCell(0, 5)).toBeNull();
    runtime.dispose();
  });

  it("updates model colors in place without changing terminal content", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 18,
      cols: 8,
      rows: 2,
      config: {
        fgColor: 0x010203,
        bgColor: 0x040506,
        cursorColor: 0x070809,
        palette: Array.from({ length: 16 }, () => 0),
      },
    });
    model.write(new TextEncoder().encode("A"));
    model.consumeDamage();
    const revision = model.revision();

    expect(model.setColors(0x112233, 0x445566, 0x778899, [])).toBe(true);
    expect(model.revision()).toBe(revision);
    expect(model.consumeDamage()).toEqual({ kind: "full" });
    expect(model.renderCells().foregroundPacked(0)).toBe(0x112233);
    expect(readViewportRows(model)[0]).toBe("A");
    model.dispose();
  });

  it("rejects duplicate leaves and unbounded dimensions", async () => {
    const runtime = new GhosttyCoreRuntime(() =>
      TeraxGhostty.loadBytes(wasmBytes.slice(0)),
    );
    const model = await runtime.createModel({
      leafId: 11,
      cols: 80,
      rows: 24,
    });

    await expect(
      runtime.createModel({ leafId: 11, cols: 80, rows: 24 }),
    ).rejects.toThrow("already exists");
    await expect(
      runtime.createModel({ leafId: 12, cols: 4_096, rows: 4_096 }),
    ).rejects.toThrow(RangeError);
    expect(runtime.diagnostics().pendingModelCount).toBe(0);
    model.dispose();
  });

  describe("one WebAssembly instance per terminal model", () => {
    function observedCore() {
      const modules: WebAssembly.Module[] = [];
      const core = TeraxGhostty.fromModule(wasmModule, {
        instantiate: (module, imports) => {
          modules.push(module);
          return new WebAssembly.Instance(module, imports);
        },
      });
      return { core, modules };
    }

    it("instantiates one shared compiled module once per model", async () => {
      const compile = vi.spyOn(WebAssembly, "compile");
      const { core, modules } = observedCore();
      const loader = vi.fn(() => Promise.resolve(core));
      const runtime = new GhosttyCoreRuntime(loader);
      try {
        const models = await Promise.all(
          Array.from({ length: 8 }, (_, leafId) =>
            runtime.createModel({ leafId, cols: 80, rows: 24 }),
          ),
        );

        expect(loader).toHaveBeenCalledTimes(1);
        expect(compile).not.toHaveBeenCalled();
        expect(modules).toHaveLength(8);
        expect(new Set(modules).size).toBe(1);
        expect(modules[0]).toBe(core.compiledModule);
        expect(core.memoryStats().instanceCount).toBe(8);
        expect(runtime.diagnostics()).toMatchObject({
          modelCount: 8,
          wasmInstanceCount: 8,
          wasmModuleCached: true,
        });
        for (const model of models.slice(0, 3)) model.dispose();
        expect(runtime.diagnostics().wasmInstanceCount).toBe(5);
      } finally {
        compile.mockRestore();
        runtime.dispose();
      }
      expect(core.memoryStats().instanceCount).toBe(0);
    });

    it("gives every model a private linear memory", async () => {
      const { core } = observedCore();
      const runtime = new GhosttyCoreRuntime(() => Promise.resolve(core));
      try {
        const models = await Promise.all(
          [0, 1, 2].map((leafId) =>
            runtime.createModel({ leafId, cols: 120, rows: 40 }),
          ),
        );
        const idle = core.memoryStats().instanceBytes;
        expect(new Set(idle).size).toBe(1);

        models[1].write(
          new TextEncoder().encode("busy output line\r\n".repeat(60_000)),
        );
        const busy = core.memoryStats().instanceBytes;
        expect(busy[1]).toBeGreaterThan(idle[1] + 1024 * 1024);
        expect(busy[0]).toBe(idle[0]);
        expect(busy[2]).toBe(idle[2]);
        expect(models[0].readText(24)).toBe("");
      } finally {
        runtime.dispose();
      }
    });

    it("accounts memory as the sum over live instances", async () => {
      const { core } = observedCore();
      const runtime = new GhosttyCoreRuntime(() => Promise.resolve(core));
      const models = await Promise.all(
        [0, 1, 2].map((leafId) =>
          runtime.createModel({ leafId, cols: 100, rows: 30 }),
        ),
      );
      const encode = (text: string) => new TextEncoder().encode(text);
      models[0].write(encode("a line of output\r\n".repeat(20_000)));
      models[2].write(encode("another line\r\n".repeat(5_000)));
      const measured = models.map((model) => {
        model.renderFormat();
        return model.consumeGpuFrame().memory.buffer.byteLength;
      });

      const stats = core.memoryStats();
      expect(stats.instanceBytes).toHaveLength(3);
      expect([...stats.instanceBytes].sort((a, b) => a - b)).toEqual(
        [...measured].sort((a, b) => a - b),
      );
      expect(stats.totalBytes).toBe(measured.reduce((a, b) => a + b, 0));
      expect(core.getMemoryBytes()).toBe(stats.totalBytes);
      expect(runtime.diagnostics().wasmMemoryBytes).toBe(stats.totalBytes);

      const closed = measured[0];
      models[0].dispose();
      expect(runtime.diagnostics().wasmMemoryBytes).toBe(
        stats.totalBytes - closed,
      );
      runtime.disposeAllModels();
      expect(runtime.diagnostics()).toMatchObject({
        wasmMemoryBytes: 0,
        wasmInstanceCount: 0,
        modelCount: 0,
      });
      runtime.dispose();
    });

    it("probes native device attributes once on a throwaway instance", async () => {
      const { core } = observedCore();
      const runtime = new GhosttyCoreRuntime(() => Promise.resolve(core));
      try {
        await runtime.preload();
        expect(core.memoryStats().instancesCreated).toBe(0);
        for (let index = 0; index < 5; index += 1) {
          expect(runtime.diagnostics().nativeDeviceAttributes).toBe(true);
        }
        expect(core.memoryStats()).toMatchObject({
          instancesCreated: 1,
          instanceCount: 0,
        });
        const model = await runtime.createModel({
          leafId: 1,
          cols: 80,
          rows: 24,
        });
        runtime.diagnostics();
        expect(core.memoryStats().instancesCreated).toBe(2);
        model.dispose();
      } finally {
        runtime.dispose();
      }
    });

    it("frees a disposed model's memory while the disposed model is still referenced", async () => {
      const { core } = observedCore();
      const runtime = new GhosttyCoreRuntime(() => Promise.resolve(core));
      const open = async () => {
        const model = await runtime.createModel({
          leafId: 40,
          cols: 120,
          rows: 40,
        });
        model.write(
          new TextEncoder().encode("scrollback line\r\n".repeat(30_000)),
        );
        return {
          model,
          memory: weak(model.consumeGpuFrame().memory),
        };
      };
      try {
        const { model, memory } = await open();
        await expect(collected(memory)).resolves.toBe(false);

        model.dispose();
        expect(model.isDisposed?.()).toBe(true);
        expect(() => model.consumeGpuFrame()).toThrow("disposed");
        await expect(collected(memory)).resolves.toBe(true);
        expect(runtime.getModel(40)).toBeNull();
        expect(core.memoryStats().instanceCount).toBe(0);
      } finally {
        runtime.dispose();
      }
    });

    it("detaches borrowed views when the model is disposed", async () => {
      const runtime = new GhosttyCoreRuntime(() =>
        TeraxGhostty.loadBytes(wasmBytes.slice(0)),
      );
      try {
        const model = await runtime.createModel({
          leafId: 41,
          cols: 40,
          rows: 8,
        });
        model.write(new TextEncoder().encode("borrowed"));
        const { cells } = model.consumeGpuFrame();
        expect(cells.byteLength).toBe(40 * 8 * 16);
        model.dispose();
        expect(cells.byteLength).toBe(0);
      } finally {
        runtime.dispose();
      }
    });

    it("frees the instance when its last terminal is disposed", async () => {
      const core = TeraxGhostty.fromModule(wasmModule);
      const open = () => {
        const terminal = core.createTerminal(80, 24);
        terminal.write(new TextEncoder().encode("hello\r\n".repeat(5_000)));
        terminal.updateRenderState();
        return { terminal, memory: weak(terminal.wasmMemory) };
      };
      const { terminal, memory } = open();
      expect(terminal.instanceMemoryBytes).toBeGreaterThan(0);
      terminal.dispose();
      expect(() => terminal.write(new Uint8Array([65]))).toThrow("disposed");
      await expect(collected(memory)).resolves.toBe(true);
      expect(core.memoryStats().instanceCount).toBe(0);
    });

    it("invalidates every terminal of a disposed shared instance", async () => {
      const core = TeraxGhostty.fromModule(wasmModule);
      const instance = core.instantiate();
      const first = instance.createTerminal(20, 4);
      const second = instance.createTerminal(20, 4);
      first.write(new TextEncoder().encode("shared"));
      expect(core.memoryStats().instanceCount).toBe(1);
      second.dispose();
      expect(core.memoryStats().instanceCount).toBe(1);
      expect(first.readTextRange(0, 0).trim()).toBe("shared");

      instance.dispose();
      expect(instance.disposed).toBe(true);
      expect(instance.memoryBytes).toBe(0);
      expect(core.getMemoryBytes()).toBe(0);
      expect(() => first.write(new Uint8Array([65]))).toThrow("disposed");
      expect(() => instance.createTerminal(20, 4)).toThrow("disposed");
      first.dispose();
    });

    it("hints the engine to collect once per burst of released instances", async () => {
      vi.useFakeTimers();
      try {
        const reclaim = vi.fn();
        const core = TeraxGhostty.fromModule(wasmModule, { reclaim });
        const terminals = [1, 2, 3].map(() => core.createTerminal(80, 24));
        const sizes = terminals.map((terminal) => terminal.instanceMemoryBytes);
        for (const terminal of terminals) terminal.dispose();
        expect(reclaim).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(249);
        expect(reclaim).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(reclaim).toHaveBeenCalledExactlyOnceWith(
          sizes.reduce((total, bytes) => total + bytes, 0),
        );

        core.createTerminal(80, 24).dispose();
        await vi.advanceTimersByTimeAsync(250);
        expect(reclaim).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("runs the default collection hint and honours opting out", async () => {
      vi.useFakeTimers();
      try {
        const core = TeraxGhostty.fromModule(wasmModule);
        core.createTerminal(80, 24).dispose();
        await expect(vi.advanceTimersByTimeAsync(250)).resolves.not.toThrow();

        const reclaim = vi.fn();
        const silent = TeraxGhostty.fromModule(wasmModule, {
          reclaim: null,
        });
        silent.createTerminal(80, 24).dispose();
        const custom = TeraxGhostty.fromModule(wasmModule, {
          reclaim,
          reclaimDelayMs: 10,
        });
        custom.createTerminal(80, 24).dispose();
        await vi.advanceTimersByTimeAsync(10);
        expect(reclaim).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });

    it("leaves no instance behind when terminal creation fails", () => {
      const core = TeraxGhostty.fromModule(wasmModule);
      expect(() => core.createTerminal(0, 24)).toThrow(RangeError);
      expect(core.memoryStats()).toMatchObject({
        instanceCount: 0,
        instancesCreated: 0,
      });
      const instance = core.instantiate();
      expect(() => instance.createTerminal(5_000, 24)).toThrow(RangeError);
      instance.dispose();
      expect(core.memoryStats().instanceCount).toBe(0);
    });
  });

  describe("global scrollback budget", () => {
    const MIB = 1024 * 1024;
    const REQUEST = 9_600_000;
    const pump = (
      model: { write(bytes: Uint8Array): void },
      lines: number,
    ): void => {
      const slice = new TextEncoder().encode(
        `${"x".repeat(98)}\r\n`.repeat(300),
      );
      for (let written = 0; written < lines; written += 300) model.write(slice);
    };

    it("divides the budget between models and returns it when they close", async () => {
      const runtime = new GhosttyCoreRuntime(
        () => TeraxGhostty.loadBytes(wasmBytes.slice(0)),
        { scrollbackBudgetBytes: 12 * MIB },
      );
      try {
        const create = (leafId: number) =>
          runtime.createModel({ leafId, cols: 120, rows: 40 });
        await create(1);
        expect(runtime.diagnostics()).toMatchObject({
          scrollbackBudgetBytes: 12 * MIB,
          scrollbackRequestedBytes: REQUEST,
          scrollbackGrantedBytes: REQUEST,
        });

        await create(2);
        const shared = runtime.diagnostics();
        expect(shared.scrollbackRequestedBytes).toBe(2 * REQUEST);
        expect(shared.scrollbackGrantedBytes).toBeLessThanOrEqual(12 * MIB);
        expect(shared.scrollbackGrantedBytes).toBeGreaterThan(12 * MIB - 4);

        await create(3);
        const crowded = runtime.diagnostics();
        expect(crowded.scrollbackGrantedBytes).toBeLessThanOrEqual(12 * MIB);
        expect(crowded.scrollbackGrantedBytes).toBeGreaterThan(12 * MIB - 4);

        runtime.disposeModel(2);
        runtime.disposeModel(3);
        expect(runtime.diagnostics().scrollbackGrantedBytes).toBe(REQUEST);
      } finally {
        runtime.dispose();
      }
    });

    it("stops later terminals at their share without pruning history already held", async () => {
      const runtime = new GhosttyCoreRuntime(
        () => TeraxGhostty.loadBytes(wasmBytes.slice(0)),
        { scrollbackBudgetBytes: 12 * MIB },
      );
      try {
        const first = await runtime.createModel({
          leafId: 1,
          cols: 120,
          rows: 40,
        });
        pump(first, 12_000);
        const history = first.scrollPosition().history;
        expect(history).toBeGreaterThan(5_000);
        const firstMemory = runtime.diagnostics().wasmMemoryBytes;

        const [second, third] = await Promise.all(
          [2, 3].map((leafId) =>
            runtime.createModel({ leafId, cols: 120, rows: 40 }),
          ),
        );
        expect(first.scrollPosition().history).toBe(history);
        const granted = runtime.diagnostics().scrollbackGrantedBytes;
        expect(granted).toBeLessThanOrEqual(12 * MIB + 2 * 2 * MIB);

        pump(second, 20_000);
        pump(third, 20_000);
        expect(first.scrollPosition().history).toBe(history);
        const floorLines = Math.ceil((2 * MIB) / (120 * 8)) + 600;
        expect(second.scrollPosition().history).toBeLessThan(floorLines);
        expect(second.scrollPosition().history).toBeGreaterThan(1_000);
        expect(third.scrollPosition().history).toBeLessThan(floorLines);
        expect(
          runtime.diagnostics().wasmMemoryBytes - firstMemory,
        ).toBeLessThan(2 * (2 * MIB + 3 * MIB));

        runtime.disposeModel(1);
        expect(
          runtime.diagnostics().scrollbackGrantedBytes,
        ).toBeLessThanOrEqual(12 * MIB);
        pump(second, 20_000);
        expect(second.scrollPosition().history).toBeGreaterThan(floorLines);
        expect(() => runtime.setScrollbackBudget(0)).toThrow(RangeError);
      } finally {
        runtime.dispose();
      }
    });

    it("does not scale terminals while the total fits the default budget", async () => {
      const runtime = new GhosttyCoreRuntime(() =>
        TeraxGhostty.loadBytes(wasmBytes.slice(0)),
      );
      try {
        await Promise.all(
          Array.from({ length: 20 }, (_, leafId) =>
            runtime.createModel({ leafId, cols: 120, rows: 40 }),
          ),
        );
        const diagnostics = runtime.diagnostics();
        expect(diagnostics.scrollbackGrantedBytes).toBe(
          diagnostics.scrollbackRequestedBytes,
        );
        expect(diagnostics.scrollbackRequestedBytes).toBeLessThanOrEqual(
          diagnostics.scrollbackBudgetBytes,
        );
      } finally {
        runtime.dispose();
      }
    });
  });
});

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function readViewportRows(model: {
  readonly cols: number;
  readonly rows: number;
  viewport(): { bytes: Uint8Array };
}): string[] {
  const cells = new PackedCellView(model.viewport().bytes);
  const lines: string[] = [];
  for (let row = 0; row < model.rows; row += 1) {
    let line = "";
    for (let column = 0; column < model.cols; column += 1) {
      const index = row * model.cols + column;
      const codepoint = cells.codepoint(index);
      line +=
        cells.width(index) === 0 || codepoint === 0
          ? " "
          : String.fromCodePoint(codepoint);
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
